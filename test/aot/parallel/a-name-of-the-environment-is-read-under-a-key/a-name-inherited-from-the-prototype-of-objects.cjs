function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const shown = raw => { parses++; return raw === undefined ? "none" : typeof raw; };
const readers = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "__defineGetter__", "isPrototypeOf"].map(name => kept(name, shown));
for (let t = 0; t < 12; t++) { if (t === 4) { process.env.constructor = "own"; process.env.toString = "own-too"; } if (t === 8) { delete process.env.constructor; delete process.env.toString; } for (const reader of readers) said.push(reader()); }
console.log(said.join(" "), parses);
