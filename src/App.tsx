import { useState, useEffect, useRef, useCallback, useMemo } from "react";

declare global {
  interface Window { Tone: any; }
}

// ─── Types ────────────────────────────────────────────────────────
type ChordFunction = "Tonic" | "Subdominant" | "Dominant";
type ChordVariant  = "triad" | "seventh" | "inversion";
type ScaleType     = "major" | "natural_minor" | "harmonic_minor";

interface ChordDef {
  id: string;
  name: string;
  roman: string;
  quality: string;
  function: ChordFunction;
  variant: ChordVariant;
  notes: string[];
  display: string[];
  desc: string;
  inversion?: string;
  scalePosition: number;
}

interface SavedProgression {
  name: string;
  chords: string[];
  key: string;
  scaleType: ScaleType;
  date: string;
}

// ─── Music Theory Engine ──────────────────────────────────────────

const CHROMATIC = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const ENHARMONIC: Record<string, string> = {
  "C#":"Db","D#":"Eb","F#":"Gb","G#":"Ab","A#":"Bb",
};

// Keys that prefer flat note spellings
const FLAT_KEYS = new Set(["F","Bb","Eb","Ab","Db","Gb","Dm","Gm","Cm","Fm","Bbm","Ebm","Abm"]);

const ROOT_TO_SEMITONE: Record<string, number> = {
  C:0,D:2,E:4,F:5,G:7,A:9,B:11,
  "C#":1,"D#":3,"F#":6,"G#":8,"A#":10,
  Db:1,Eb:3,Gb:6,Ab:8,Bb:10,
};

// ── Scale interval definitions ────────────────────────────────────
const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  major:          [0,2,4,5,7,9,11],
  natural_minor:  [0,2,3,5,7,8,10],
  harmonic_minor: [0,2,3,5,7,8,11],
};

// ── Quality patterns per scale type (7 positions) ─────────────────
const TRIAD_QUALITIES_BY_SCALE: Record<ScaleType, string[]> = {
  major:          ["major","minor","minor","major","major","minor","diminished"],
  natural_minor:  ["minor","diminished","major","minor","minor","major","major"],
  harmonic_minor: ["minor","diminished","augmented","minor","major","major","diminished"],
};

const SEVENTH_QUALITIES_BY_SCALE: Record<ScaleType, string[]> = {
  major:          ["maj7","min7","min7","maj7","dom7","min7","halfDim7"],
  natural_minor:  ["min7","halfDim7","maj7","min7","min7","maj7","dom7"],
  harmonic_minor: ["minMaj7","halfDim7","augMaj7","min7","dom7","maj7","dim7"],
};

// ── Harmonic function per scale position ─────────────────────────
const FUNCTIONS_BY_SCALE: Record<ScaleType, ChordFunction[]> = {
  major:          ["Tonic","Subdominant","Tonic","Subdominant","Dominant","Tonic","Dominant"],
  natural_minor:  ["Tonic","Subdominant","Tonic","Subdominant","Dominant","Subdominant","Dominant"],
  harmonic_minor: ["Tonic","Subdominant","Tonic","Subdominant","Dominant","Subdominant","Dominant"],
};

// ── Roman numeral labels ──────────────────────────────────────────
const ROMANS_BY_SCALE: Record<ScaleType, { triad: string[]; seventh: string[] }> = {
  major: {
    triad:   ["I","ii","iii","IV","V","vi","vii°"],
    seventh: ["Imaj7","ii7","iii7","IVmaj7","V7","vi7","viiø7"],
  },
  natural_minor: {
    triad:   ["i","ii°","III","iv","v","VI","VII"],
    seventh: ["im7","iiø7","IIImaj7","iv7","v7","VImaj7","VII7"],
  },
  harmonic_minor: {
    triad:   ["i","ii°","III+","iv","V","VI","vii°"],
    seventh: ["imM7","iiø7","III+maj7","iv7","V7","VImaj7","vii°7"],
  },
};

// ── Chord IDs (stable keys used in the CHORDS map) ───────────────
const TRIAD_IDS  = ["I","ii","iii","IV","V","vi","vii"];
const SEVENTH_IDS = ["Imaj7","ii7","iii7","IV7","V7","vi7","vii7"];

// ── Human-readable descriptions ───────────────────────────────────
const TRIAD_DESCS_BY_SCALE: Record<ScaleType, string[]> = {
  major: [
    "The home chord — where everything resolves",
    "Creates gentle tension, pulls toward V or IV",
    "A softer tonic — dreamy and ambiguous",
    "Moves away from home — adds lift and motion",
    "Strong tension — desperately wants to go home",
    "The emotional tonic — melancholic and rich",
    "Unstable and tense — strongest pull to resolve",
  ],
  natural_minor: [
    "Dark, heavy home — melancholic and grounded",
    "Diminished subdominant — unstable, pulls forward",
    "The relative major — bright relief in a dark key",
    "Minor subdominant — deep and sorrowful",
    "Weak dominant — no leading tone, gentle pull home",
    "Major subdominant — warm and unexpected brightness",
    "Subtonic — soft dominant, resolves without urgency",
  ],
  harmonic_minor: [
    "Dark, heavy home — melancholic and grounded",
    "Diminished subdominant — unstable, pulls forward",
    "Augmented tonic — eerie and unsettled",
    "Minor subdominant — deep and sorrowful",
    "Strong dominant — raised 7th creates powerful pull to i",
    "Major subdominant — warm and unexpected brightness",
    "Leading tone diminished — intense pull to resolve",
  ],
};

const SEVENTH_DESCS_BY_SCALE: Record<ScaleType, string[]> = {
  major: [
    "Dreamy, floating tonic — lush and open",
    "Smooth, jazzy subdominant — silky motion",
    "Mellow tonic color — warm and gentle",
    "Bright, airy subdominant — uplifting feel",
    "The classic tension chord — must resolve to I",
    "Soulful, melancholic — rich emotional color",
    "Half-diminished tension — sophisticated pull",
  ],
  natural_minor: [
    "Minor 7th tonic — dark and moody",
    "Half-diminished — tense, fragile subdominant",
    "Major 7th — bright island in a minor sea",
    "Minor 7th subdominant — deep and melancholic",
    "Minor 7th dominant — soft, unresolved pull",
    "Major 7th — warmth against the minor darkness",
    "Dominant 7th subtonic — smooth resolution option",
  ],
  harmonic_minor: [
    "Minor-major 7th — dramatic, cinematic tonic",
    "Half-diminished — fragile subdominant tension",
    "Augmented major 7th — exotic and tense",
    "Minor 7th subdominant — deep and sorrowful",
    "Dominant 7th — strongest pull, V7 restores in minor",
    "Major 7th — unexpected brightness in the darkness",
    "Fully diminished — maximum tension, demands resolution",
  ],
};

// ── Note display helper ───────────────────────────────────────────
function displayNote(chromNote: string, key: string): string {
  if (FLAT_KEYS.has(key) && ENHARMONIC[chromNote]) return ENHARMONIC[chromNote];
  return chromNote;
}

// ── Chord interval builder ────────────────────────────────────────
function buildChordSemitones(rootSemitone: number, quality: string): number[] {
  const intervalMap: Record<string, number[]> = {
    major:      [0,4,7],
    minor:      [0,3,7],
    diminished: [0,3,6],
    augmented:  [0,4,8],
    maj7:       [0,4,7,11],
    min7:       [0,3,7,10],
    dom7:       [0,4,7,10],
    halfDim7:   [0,3,6,10],
    dim7:       [0,3,6,9],
    minMaj7:    [0,3,7,11],
    augMaj7:    [0,4,8,11],
  };
  return (intervalMap[quality] ?? [0,4,7]).map(i => (rootSemitone + i) % 12);
}

// ── Note + octave builder ─────────────────────────────────────────
function buildNotes(semitones: number[], key: string, bassOctave = 4): { notes: string[]; display: string[] } {
  const noteNames = semitones.map(s => displayNote(CHROMATIC[s % 12], key));
  const notes: string[] = [];
  let octave = bassOctave;
  let prev = -1;

  semitones.forEach((s, i) => {
    if (i > 0 && s <= prev) octave++;
    notes.push(`${noteNames[i]}${octave}`);
    prev = s;
  });

  return { notes, display: noteNames };
}

// ── Name builder ──────────────────────────────────────────────────
function chordName(rootName: string, quality: string): string {
  const suffixMap: Record<string, string> = {
    major:"", minor:"m", diminished:"°", augmented:"+",
    maj7:"maj7", min7:"m7", dom7:"7", halfDim7:"ø7",
    dim7:"°7", minMaj7:"mM7", augMaj7:"+maj7",
  };
  return `${rootName}${suffixMap[quality] ?? ""}`;
}

// ── Main generator ────────────────────────────────────────────────
function generateChords(key: string, scaleType: ScaleType): Record<string, ChordDef> {
  const rootSemitone = ROOT_TO_SEMITONE[key] ?? 0;
  const intervals    = SCALE_INTERVALS[scaleType];
  const scale        = intervals.map(i => (rootSemitone + i) % 12);
  const chords: Record<string, ChordDef> = {};

  const triadQualities   = TRIAD_QUALITIES_BY_SCALE[scaleType];
  const seventhQualities = SEVENTH_QUALITIES_BY_SCALE[scaleType];
  const functions        = FUNCTIONS_BY_SCALE[scaleType];
  const romans           = ROMANS_BY_SCALE[scaleType];
  const triadDescs       = TRIAD_DESCS_BY_SCALE[scaleType];
  const seventhDescs     = SEVENTH_DESCS_BY_SCALE[scaleType];

  scale.forEach((degreeSemitone, pos) => {
    const fn           = functions[pos];
    const tQ           = triadQualities[pos];
    const sQ           = seventhQualities[pos];
    const rootName     = displayNote(CHROMATIC[degreeSemitone], key);
    const triadId      = TRIAD_IDS[pos];
    const seventhId    = SEVENTH_IDS[pos];

    // ── Triad ──
    const triadSemitones = buildChordSemitones(degreeSemitone, tQ);
    const { notes: tNotes, display: tDisplay } = buildNotes(triadSemitones, key);

    chords[triadId] = {
      id: triadId, name: chordName(rootName, tQ),
      roman: romans.triad[pos], quality: tQ, function: fn,
      variant: "triad", notes: tNotes, display: tDisplay,
      desc: triadDescs[pos], scalePosition: pos,
    };

    // ── 7th chord ──
    const seventhSemitones = buildChordSemitones(degreeSemitone, sQ);
    const { notes: sNotes, display: sDisplay } = buildNotes(seventhSemitones, key);

    chords[seventhId] = {
      id: seventhId, name: chordName(rootName, sQ),
      roman: romans.seventh[pos], quality: sQ, function: fn,
      variant: "seventh", notes: sNotes, display: sDisplay,
      desc: seventhDescs[pos], scalePosition: pos,
    };

    // ── First inversion for I/i, IV/iv, V/v ──
    if ([0, 3, 4].includes(pos)) {
      const thirdSemitone = triadSemitones[1];
      const thirdName     = displayNote(CHROMATIC[thirdSemitone % 12], key);
      const { notes: upperNotes, display: invDisplay } = buildNotes(triadSemitones, key, 4);
      const invId         = `${triadId}/${thirdName}`;
      const invRomans     = [
        scaleType === "major" ? "I⁶"  : "i⁶",
        "", "",
        scaleType === "major" ? "IV⁶" : "iv⁶",
        scaleType === "major" ? "V⁶"  : "V⁶",
        "", "",
      ];
      const invDescs = [
        "Smooth bass motion — lighter tonic feel",
        "","",
        "Bass rises naturally — lifts the subdominant",
        "Elegant tension with smooth bass line",
        "","",
      ];

      chords[invId] = {
        id: invId, name: `${chordName(rootName, tQ)}/${thirdName}`,
        roman: invRomans[pos], quality: tQ, function: fn,
        variant: "inversion", notes: [`${thirdName}3`, ...upperNotes],
        display: invDisplay, desc: invDescs[pos],
        inversion: "1st inv", scalePosition: pos,
      };
    }
  });

  return chords;
}

// ── Rule-based suggestion engine ─────────────────────────────────
const FUNCTION_FLOW: Record<ChordFunction, ChordFunction[]> = {
  Tonic:       ["Subdominant","Dominant","Tonic"],
  Subdominant: ["Dominant","Tonic","Subdominant"],
  Dominant:    ["Tonic","Subdominant","Dominant"],
};

const POSITION_PREFS: Record<ChordFunction, number[]> = {
  Tonic:       [0,5,2],
  Subdominant: [3,1,5],
  Dominant:    [4,6],
};

function getSuggestions(current: ChordDef, allChords: Record<string, ChordDef>, variant: ChordVariant): string[] {
  const results: string[] = [];

  FUNCTION_FLOW[current.function].forEach(fn => {
    (POSITION_PREFS[fn] ?? []).forEach(pos => {
      Object.values(allChords).forEach(c => {
        if (c.function === fn && c.scalePosition === pos && c.variant === variant
            && c.id !== current.id && !results.includes(c.id)) {
          results.push(c.id);
        }
      });
    });
  });

  // Add relevant inversions for smooth voice leading
  Object.values(allChords).forEach(c => {
    if (c.variant === "inversion" && !results.includes(c.id)) {
      const flows =
        (current.function === "Tonic"       && c.function === "Subdominant") ||
        (current.function === "Subdominant" && c.function === "Dominant")    ||
        (current.function === "Dominant"    && c.function === "Tonic");
      if (flows) results.push(c.id);
    }
  });

  return results.slice(0, 8);
}

// ─── Constants ────────────────────────────────────────────────────
const MAJOR_KEYS = ["C","G","D","A","E","B","F#","F","Bb","Eb","Ab","Db"];
const MINOR_KEYS = ["Am","Em","Bm","F#m","C#m","G#m","D#m","Dm","Gm","Cm","Fm","Bbm"];

// Strip the trailing 'm' to get the root note for minor keys
function minorKeyRoot(key: string): string {
  return key.endsWith("m") ? key.slice(0,-1) : key;
}

const FUNCTION_COLORS: Record<ChordFunction, { bg: string; border: string; glow: string; label: string }> = {
  Tonic:       { bg:"rgba(59,130,246,0.15)",  border:"#3b82f6", glow:"#3b82f680", label:"#60a5fa" },
  Subdominant: { bg:"rgba(16,185,129,0.15)",  border:"#10b981", glow:"#10b98180", label:"#34d399" },
  Dominant:    { bg:"rgba(239,68,68,0.15)",   border:"#ef4444", glow:"#ef444480", label:"#f87171" },
};

// ─── Audio Engine ─────────────────────────────────────────────────
function useAudioEngine(chordsRef: React.MutableRefObject<Record<string, ChordDef>>) {
  const synthRef  = useRef<any>(null);
  const reverbRef = useRef<any>(null);

  const init = useCallback(async () => {
    if (synthRef.current) return;
    const Tone = window.Tone;
    await Tone.start();
    reverbRef.current = new Tone.Reverb({ decay: 1.2, wet: 0.25 }).toDestination();
    synthRef.current  = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope:   { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.5 },
      volume: -8,
    }).connect(reverbRef.current);
  }, []);

  const playChord = useCallback(async (notes: string[]) => {
    await init();
    synthRef.current.triggerAttackRelease(notes, "4n", window.Tone.now());
  }, [init]);

  const playProgression = useCallback(async (
    ids: string[], bpm: number, loop: boolean, onStep: (step: number) => void
  ) => {
    await init();
    const Tone = window.Tone;
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.bpm.value = bpm;
    let step = 0;
    const total = ids.length;

    Tone.Transport.scheduleRepeat((time: number) => {
      const currentStep = step % total;
      const chord = chordsRef.current[ids[currentStep]];
      if (chord) {
        synthRef.current.triggerAttackRelease(chord.notes, "2n", time);
        Tone.Draw.schedule(() => onStep(currentStep), time);
      }
      step++;
      if (!loop && step >= total) {
        Tone.Transport.stop();
        Tone.Draw.schedule(() => onStep(-1), time + Tone.Time("2n").toSeconds());
      }
    }, "2n");

    Tone.Transport.start();
  }, [init, chordsRef]);

  const stopPlayback = useCallback(() => {
    if (window.Tone) { window.Tone.Transport.stop(); window.Tone.Transport.cancel(); }
  }, []);

  return { playChord, playProgression, stopPlayback };
}

// ─── Sub-components ───────────────────────────────────────────────
function ChordCard({ chord, onClick, isSelected, isSuggested, activeStep, progressionIndex }: {
  chord: ChordDef; onClick: (id: string) => void;
  isSelected: boolean; isSuggested: boolean;
  activeStep: number; progressionIndex?: number;
}) {
  const fc = FUNCTION_COLORS[chord.function];
  const isPlaying = activeStep === progressionIndex;

  return (
    <div onClick={() => onClick(chord.id)} style={{
      background:  isSelected ? fc.bg : isSuggested ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
      border:     `1px solid ${isSelected ? fc.border : isSuggested ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.07)"}`,
      boxShadow:   isSelected ? `0 0 20px ${fc.glow}, 0 0 40px ${fc.glow}40` : isPlaying ? `0 0 16px ${fc.glow}` : "none",
      transform:   isSelected ? "scale(1.04)" : isPlaying ? "scale(1.02)" : "scale(1)",
      outline:     isPlaying ? `2px solid ${fc.border}` : "none",
      transition: "all 0.2s ease", cursor: "pointer", borderRadius: "12px", padding: "16px 12px", minWidth: 0,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
        <span style={{ fontSize:20, fontWeight:700, fontFamily:"'Playfair Display', serif", color: isSelected || isSuggested ? "#fff" : "#888" }}>
          {chord.name}
        </span>
        <span style={{ fontSize:10, fontFamily:"monospace", color:fc.label, background:fc.bg, border:`1px solid ${fc.border}40`, borderRadius:4, padding:"2px 6px" }}>
          {chord.roman}
        </span>
      </div>
      <div style={{ fontSize:11, color:fc.label, fontWeight:600, marginBottom:4, letterSpacing:"0.05em" }}>
        {chord.function}{chord.inversion ? ` · ${chord.inversion}` : ""}
      </div>
      <div style={{ fontSize:11, color:"#777", marginBottom:6, lineHeight:1.3 }}>{chord.desc}</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
        {chord.display.map((n: string, i: number) => (
          <span key={i} style={{ fontSize:11, background:"rgba(255,255,255,0.08)", color:"#e2e8f0", borderRadius:4, padding:"2px 7px", fontFamily:"monospace" }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProgressionSlot({ chord, index, isActive, onRemove, onPlay }: {
  chord: ChordDef; index: number; isActive: boolean;
  onRemove: (i: number) => void; onPlay: (i: number) => void;
}) {
  const fc = FUNCTION_COLORS[chord.function];
  return (
    <div onClick={() => onPlay(index)} style={{
      position:"relative", background: isActive ? fc.bg : "rgba(255,255,255,0.04)",
      border:`1px solid ${isActive ? fc.border : "rgba(255,255,255,0.1)"}`,
      boxShadow: isActive ? `0 0 16px ${fc.glow}` : "none",
      borderRadius:10, padding:"10px 14px", minWidth:72,
      transition:"all 0.15s ease", cursor:"pointer",
    }}>
      <div style={{ fontSize:16, fontWeight:700, fontFamily:"'Playfair Display', serif", color:"#fff" }}>{chord.name}</div>
      <div style={{ fontSize:10, color:fc.label, letterSpacing:"0.05em" }}>{chord.function}</div>
      <button onClick={e => { e.stopPropagation(); onRemove(index); }}
        style={{ position:"absolute", top:4, right:6, background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:14 }}>×</button>
    </div>
  );
}

function SavedDrawer({ savedProgressions, onLoad, onDelete, onClose }: {
  savedProgressions: SavedProgression[];
  onLoad: (p: SavedProgression) => void;
  onDelete: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:50, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)", display:"flex", justifyContent:"flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width:360, background:"#0f1117", height:"100%", overflowY:"auto", borderLeft:"1px solid rgba(255,255,255,0.1)", padding:24 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <h2 style={{ color:"#fff", fontFamily:"'Playfair Display', serif", fontSize:22, margin:0 }}>Saved Progressions</h2>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#888", fontSize:22, cursor:"pointer" }}>×</button>
        </div>
        {savedProgressions.length === 0 && <p style={{ color:"#555", fontSize:14 }}>No saved progressions yet.</p>}
        {savedProgressions.map((prog, i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:16, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ color:"#fff", fontWeight:600, fontSize:15 }}>{prog.name}</span>
              <span style={{ color:"#555", fontSize:11 }}>{prog.date}</span>
            </div>
            <div style={{ color:"#555", fontSize:11, marginBottom:8 }}>
              Key of {prog.key} · {prog.scaleType === "harmonic_minor" ? "Harmonic minor" : prog.scaleType === "natural_minor" ? "Natural minor" : "Major"}
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
              {prog.chords.map((id, j) => (
                <span key={j} style={{ background:"rgba(255,255,255,0.08)", color:"#ddd", borderRadius:6, padding:"3px 10px", fontSize:13, fontFamily:"'Playfair Display', serif" }}>{id}</span>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { onLoad(prog); onClose(); }} style={{ flex:1, background:"rgba(59,130,246,0.2)", border:"1px solid #3b82f640", color:"#60a5fa", borderRadius:6, padding:"6px 0", cursor:"pointer", fontSize:13 }}>Load</button>
              <button onClick={() => onDelete(i)} style={{ background:"rgba(239,68,68,0.15)", border:"1px solid #ef444440", color:"#f87171", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:13 }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [keyMode,           setKeyMode]           = useState<"major"|"minor">("major");
  const [currentKey,        setCurrentKey]        = useState("C");
  const [scaleType,         setScaleType]         = useState<ScaleType>("major");
  const [selectedId,        setSelectedId]        = useState<string | null>(null);
  const [progression,       setProgression]       = useState<string[]>([]);
  const [isPlaying,         setIsPlaying]         = useState(false);
  const [activeStep,        setActiveStep]        = useState(-1);
  const [bpm,               setBpm]               = useState(80);
  const [loop,              setLoop]              = useState(false);
  const [showSaved,         setShowSaved]         = useState(false);
  const [savedProgressions, setSavedProgressions] = useState<SavedProgression[]>([]);
  const [saveName,          setSaveName]          = useState("");
  const [showSaveInput,     setShowSaveInput]     = useState(false);
  const [view,              setView]              = useState<ChordVariant>("triad");

  // Derive chords from key + scaleType
  const chords = useMemo(() => {
    const root = keyMode === "minor" ? minorKeyRoot(currentKey) : currentKey;
    return generateChords(root, scaleType);
  }, [currentKey, scaleType, keyMode]);

  const chordsRef = useRef(chords);
  useEffect(() => { chordsRef.current = chords; }, [chords]);

  const { playChord, playProgression, stopPlayback } = useAudioEngine(chordsRef);

  useEffect(() => {
    try { setSavedProgressions(JSON.parse(localStorage.getItem("harmony-progressions") || "[]")); } catch {}
  }, []);

  const resetPlayState = useCallback(() => {
    stopPlayback(); setIsPlaying(false); setActiveStep(-1);
  }, [stopPlayback]);

  // Switching key mode (major ↔ minor)
  const handleKeyModeChange = useCallback((mode: "major" | "minor") => {
    setKeyMode(mode);
    setCurrentKey(mode === "major" ? "C" : "Am");
    setScaleType(mode === "major" ? "major" : "natural_minor");
    setSelectedId(null); setProgression([]); resetPlayState();
  }, [resetPlayState]);

  // Selecting a key within the current mode
  const handleKeyChange = useCallback((key: string) => {
    setCurrentKey(key);
    setSelectedId(null); setProgression([]); resetPlayState();
  }, [resetPlayState]);

  // Toggling natural ↔ harmonic (only for minor)
  const handleScaleTypeChange = useCallback((type: ScaleType) => {
    setScaleType(type);
    setSelectedId(null); setProgression([]); resetPlayState();
  }, [resetPlayState]);

  const visibleIds = view === "triad"
    ? TRIAD_IDS
    : view === "seventh"
    ? SEVENTH_IDS
    : Object.values(chords).filter(c => c.variant === "inversion").map(c => c.id);

  const suggestions = useMemo(() => {
    if (!selectedId || !chords[selectedId]) return [];
    return getSuggestions(chords[selectedId], chords, view);
  }, [selectedId, chords, view]);

  const handleChordClick = useCallback((id: string) => {
    setSelectedId(id);
    playChord(chords[id].notes);
  }, [chords, playChord]);

  const addToProgression = useCallback((id: string) => {
    setProgression(p => [...p, id]);
    playChord(chords[id].notes);
    setSelectedId(id);
  }, [chords, playChord]);

  const removeFromProgression = useCallback((index: number) => {
    setProgression(p => p.filter((_,i) => i !== index));
  }, []);

  const handlePlay = useCallback(async () => {
    if (!progression.length) return;
    if (isPlaying) { resetPlayState(); return; }
    setIsPlaying(true);
    await playProgression(progression, bpm, loop, step => {
      setActiveStep(step);
      if (step === -1) setIsPlaying(false);
    });
  }, [progression, bpm, loop, isPlaying, playProgression, resetPlayState]);

  const handleSave = () => {
    if (!saveName.trim() || !progression.length) return;
    const updated = [...savedProgressions, {
      name: saveName.trim(), chords: progression,
      key: currentKey, scaleType, date: new Date().toLocaleDateString(),
    }];
    setSavedProgressions(updated);
    localStorage.setItem("harmony-progressions", JSON.stringify(updated));
    setSaveName(""); setShowSaveInput(false);
  };

  const handleDelete = (index: number) => {
    const updated = savedProgressions.filter((_,i) => i !== index);
    setSavedProgressions(updated);
    localStorage.setItem("harmony-progressions", JSON.stringify(updated));
  };

  const handleLoad = (prog: SavedProgression) => {
    const isMinor = prog.scaleType === "natural_minor" || prog.scaleType === "harmonic_minor";
    setKeyMode(isMinor ? "minor" : "major");
    setCurrentKey(prog.key + (isMinor ? "m" : ""));
    setScaleType(prog.scaleType ?? "major");
    setProgression(prog.chords);
    setSelectedId(null); resetPlayState();
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding:"6px 16px", borderRadius:8, border:"1px solid",
    borderColor: active ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    color: active ? "#fff" : "#666", cursor:"pointer", fontSize:13,
    fontWeight: active ? 600 : 400, transition:"all 0.15s",
  });

  const keyBtnStyle = (active: boolean): React.CSSProperties => ({
    padding:"6px 14px", borderRadius:8,
    border:`1px solid ${active ? "#3b82f6" : "rgba(255,255,255,0.08)"}`,
    background: active ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.03)",
    color: active ? "#60a5fa" : "#777", cursor:"pointer", fontSize:14,
    fontWeight: active ? 700 : 400,
    fontFamily: active ? "'Playfair Display', serif" : "inherit",
    boxShadow: active ? "0 0 12px #3b82f640" : "none",
    transition:"all 0.15s",
  });

  const selectedChord = selectedId ? chords[selectedId] : null;

  // Display label for current key+scale
  const scaleLabel = scaleType === "harmonic_minor"
    ? "Harmonic Minor" : scaleType === "natural_minor"
    ? "Natural Minor" : "Major";

  return (
    <div style={{ minHeight:"100vh", background:"#080b12", color:"#fff", fontFamily:"'Inter', system-ui, sans-serif", padding:"0 0 60px" }}>

      {/* ── Header ── */}
      <div style={{ borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"18px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", background:"rgba(0,0,0,0.4)", backdropFilter:"blur(12px)", position:"sticky", top:0, zIndex:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontFamily:"'Playfair Display', serif", fontWeight:700 }}>
            Harmony <span style={{ color:"#60a5fa" }}>Trainer</span>
          </h1>
          <p style={{ margin:0, fontSize:12, color:"#555", marginTop:2 }}>
            {currentKey} {scaleLabel} · Diatonic Harmony
          </p>
        </div>
        <button onClick={() => setShowSaved(true)} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#aaa", borderRadius:8, padding:"8px 16px", cursor:"pointer", fontSize:13 }}>
          📁 Saved ({savedProgressions.length})
        </button>
      </div>

      <div style={{ maxWidth:940, margin:"0 auto", padding:"28px 20px 0" }}>

        {/* ── Key Selector ── */}
        <div style={{ marginBottom:28 }}>

          {/* Major / Minor mode tabs */}
          <div style={{ display:"flex", gap:0, marginBottom:14, borderRadius:10, overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)", width:"fit-content" }}>
            {(["major","minor"] as const).map(mode => (
              <button key={mode} onClick={() => handleKeyModeChange(mode)} style={{
                padding:"8px 24px", border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
                background: keyMode === mode ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.03)",
                color: keyMode === mode ? "#60a5fa" : "#555",
                borderRight: mode === "major" ? "1px solid rgba(255,255,255,0.08)" : "none",
                transition:"all 0.15s",
              }}>
                {mode === "major" ? "Major Keys" : "Minor Keys"}
              </button>
            ))}
          </div>

          {/* Key grid */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom: keyMode === "minor" ? 12 : 0 }}>
            {(keyMode === "major" ? MAJOR_KEYS : MINOR_KEYS).map(k => (
              <button key={k} onClick={() => handleKeyChange(k)} style={keyBtnStyle(currentKey === k)}>{k}</button>
            ))}
          </div>

          {/* Natural / Harmonic toggle (minor only) */}
          {keyMode === "minor" && (
            <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
              <span style={{ fontSize:12, color:"#555", letterSpacing:"0.05em" }}>SCALE TYPE</span>
              <div style={{ display:"flex", gap:0, borderRadius:8, overflow:"hidden", border:"1px solid rgba(255,255,255,0.08)" }}>
                {([["natural_minor","Natural"],["harmonic_minor","Harmonic"]] as [ScaleType,string][]).map(([type, label]) => (
                  <button key={type} onClick={() => handleScaleTypeChange(type)} style={{
                    padding:"5px 14px", border:"none", cursor:"pointer", fontSize:12,
                    background: scaleType === type ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.03)",
                    color: scaleType === type ? "#34d399" : "#555",
                    borderRight: type === "natural_minor" ? "1px solid rgba(255,255,255,0.08)" : "none",
                    transition:"all 0.15s",
                  }}>
                    {label}
                  </button>
                ))}
              </div>
              <span style={{ fontSize:11, color:"#444", fontStyle:"italic" }}>
                {scaleType === "harmonic_minor" ? "Raises ♮7 for a stronger V chord" : "Pure minor — no alterations"}
              </span>
            </div>
          )}
        </div>

        {/* ── Legend ── */}
        <div style={{ display:"flex", gap:20, marginBottom:24, flexWrap:"wrap" }}>
          {(Object.entries(FUNCTION_COLORS) as [ChordFunction, typeof FUNCTION_COLORS.Tonic][]).map(([fn, c]) => (
            <div key={fn} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:c.border }} />
              <span style={{ fontSize:12, color:"#888" }}>
                <span style={{ color:c.label, fontWeight:600 }}>{fn}</span>
                {fn === "Tonic" && " — home"}
                {fn === "Subdominant" && " — away from home"}
                {fn === "Dominant" && " — tension"}
              </span>
            </div>
          ))}
        </div>

        {/* ── View Tabs ── */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <button style={tabStyle(view === "triad")}     onClick={() => setView("triad")}>Triads</button>
          <button style={tabStyle(view === "seventh")}   onClick={() => setView("seventh")}>7th Chords</button>
          <button style={tabStyle(view === "inversion")} onClick={() => setView("inversion")}>Inversions</button>
        </div>

        {/* ── Chord Grid ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(118px, 1fr))", gap:12, marginBottom:28 }}>
          {visibleIds.map(id => {
            const chord = chords[id];
            if (!chord) return null;
            return (
              <ChordCard key={id} chord={chord} onClick={handleChordClick}
                isSelected={selectedId === id} isSuggested={suggestions.includes(id)}
                activeStep={activeStep} />
            );
          })}
        </div>

        {/* ── Suggestions Panel ── */}
        {selectedChord && (
          <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"20px", marginBottom:28 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
              <div>
                <span style={{ color:"#888", fontSize:13 }}>Selected: </span>
                <span style={{ color:"#fff", fontWeight:700, fontFamily:"'Playfair Display', serif", fontSize:16 }}>{selectedChord.name}</span>
                <span style={{ color:FUNCTION_COLORS[selectedChord.function].label, fontSize:13, marginLeft:8 }}>
                  {selectedChord.function} — {selectedChord.desc}
                </span>
              </div>
              <button onClick={() => addToProgression(selectedChord.id)} style={{ background:"rgba(59,130,246,0.2)", border:"1px solid #3b82f650", color:"#60a5fa", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
                + Add to Progression
              </button>
            </div>
            {suggestions.length > 0 && (
              <>
                <div style={{ fontSize:12, color:"#555", marginBottom:10 }}>Suggested next chords:</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {suggestions.map(id => {
                    const c = chords[id];
                    if (!c) return null;
                    const fc = FUNCTION_COLORS[c.function];
                    return (
                      <button key={id} onClick={() => addToProgression(id)}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 14px ${fc.glow}`)}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                        style={{ background:fc.bg, border:`1px solid ${fc.border}50`, color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontSize:13, display:"flex", flexDirection:"column", alignItems:"flex-start", gap:2, transition:"all 0.15s", minWidth:72 }}
                      >
                        <span style={{ fontWeight:700, fontFamily:"'Playfair Display', serif", fontSize:15 }}>{c.name}</span>
                        <span style={{ fontSize:10, color:fc.label }}>{c.function}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Progression Builder ── */}
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"20px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
            <h3 style={{ margin:0, fontSize:15, fontWeight:600, color:"#ccc" }}>
              Progression Builder
              {progression.length > 0 && (
                <span style={{ color:"#555", fontWeight:400, marginLeft:8, fontSize:13 }}>
                  ({progression.length} chords · {currentKey} {scaleLabel})
                </span>
              )}
            </h3>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color:"#666" }}>BPM</span>
                <input type="range" min={40} max={160} value={bpm} onChange={e => setBpm(Number(e.target.value))} style={{ width:80, accentColor:"#3b82f6" }} />
                <span style={{ fontSize:12, color:"#aaa", minWidth:28 }}>{bpm}</span>
              </div>
              <button onClick={() => setLoop(l => !l)} style={{ background: loop ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)", border:`1px solid ${loop ? "#3b82f650" : "rgba(255,255,255,0.1)"}`, color: loop ? "#60a5fa" : "#666", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:12 }}>↺ Loop</button>
              <button onClick={() => setProgression(p => p.slice(0,-1))} disabled={!progression.length} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", color: progression.length ? "#aaa" : "#333", borderRadius:8, padding:"6px 12px", cursor: progression.length ? "pointer" : "default", fontSize:12 }}>↩ Undo</button>
              <button onClick={() => { setProgression([]); resetPlayState(); }} disabled={!progression.length} style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.2)", color: progression.length ? "#f87171" : "#333", borderRadius:8, padding:"6px 12px", cursor: progression.length ? "pointer" : "default", fontSize:12 }}>✕ Clear</button>
            </div>
          </div>

          {!progression.length ? (
            <div style={{ color:"#444", fontSize:14, textAlign:"center", padding:"24px 0", borderRadius:8, border:"1px dashed rgba(255,255,255,0.06)" }}>
              Click a chord above to start building your progression
            </div>
          ) : (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {progression.map((id, i) => {
                const chord = chords[id];
                if (!chord) return null;
                return (
                  <ProgressionSlot key={i} chord={chord} index={i} isActive={activeStep === i}
                    onRemove={removeFromProgression}
                    onPlay={idx => playChord(chords[progression[idx]].notes)} />
                );
              })}
            </div>
          )}

          <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:12 }}>
            <button onClick={handlePlay} disabled={!progression.length} style={{
              background: progression.length ? (isPlaying ? "rgba(239,68,68,0.2)" : "rgba(59,130,246,0.25)") : "rgba(255,255,255,0.03)",
              border:`1px solid ${progression.length ? (isPlaying ? "#ef444450" : "#3b82f650") : "rgba(255,255,255,0.06)"}`,
              color: progression.length ? (isPlaying ? "#f87171" : "#60a5fa") : "#333",
              borderRadius:10, padding:"10px 24px", cursor: progression.length ? "pointer" : "default",
              fontSize:14, fontWeight:700, letterSpacing:"0.02em", transition:"all 0.15s",
            }}>
              {isPlaying ? "⏹ Stop" : "▶ Play Progression"}
            </button>

            {!showSaveInput ? (
              <button onClick={() => setShowSaveInput(true)} disabled={!progression.length} style={{ background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)", color: progression.length ? "#34d399" : "#333", borderRadius:10, padding:"10px 16px", cursor: progression.length ? "pointer" : "default", fontSize:13 }}>
                💾 Save
              </button>
            ) : (
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSaveInput(false); }}
                  placeholder="Name this progression..."
                  style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.15)", color:"#fff", borderRadius:8, padding:"8px 12px", fontSize:13, outline:"none", width:200 }}
                />
                <button onClick={handleSave} style={{ background:"rgba(16,185,129,0.2)", border:"1px solid rgba(16,185,129,0.3)", color:"#34d399", borderRadius:8, padding:"8px 12px", cursor:"pointer", fontSize:13 }}>Save</button>
                <button onClick={() => setShowSaveInput(false)} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:18 }}>×</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSaved && (
        <SavedDrawer savedProgressions={savedProgressions} onLoad={handleLoad} onDelete={handleDelete} onClose={() => setShowSaved(false)} />
      )}
    </div>
  );
}