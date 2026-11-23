function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const mark = Symbol("made up"); const readers = [kept(mark, parser), kept(7, parser), kept(-0, parser), kept(1.5, parser), kept(null, parser), kept(undefined, parser), kept({ toString() { return "MADE_UP_FLAG"; } }, parser), kept(Symbol.iterator, parser), kept(Symbol.toStringTag, parser)];
for (let t = 0; t < 12; t++) { if (t === 3) { process.env[7] = "seven"; process.env[1.5] = "half"; process.env.MADE_UP_FLAG = "by-text"; process.env.null = "nothing"; process.env.undefined = "undefined-too"; process.env[0] = "zero"; } if (t === 8) { delete process.env[7]; delete process.env.null; } for (const reader of readers) said.push(reader()); }
try { process.env[mark] = "x"; said.push("stored"); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(" "), parses);
