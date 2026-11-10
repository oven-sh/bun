function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const names = []; for (let k = 0; k < 24; k++) { names.push("MADE_UP_" + k); if (k % 3) process.env["MADE_UP_" + k] = "v" + k; }
const readers = names.map(name => kept(name, parser));
for (let t = 0; t < 10; t++) { if (t === 4) for (let k = 0; k < 24; k += 4) delete process.env["MADE_UP_" + k]; if (t === 7) for (let k = 0; k < 24; k += 3) process.env["MADE_UP_" + k] = "late"; let line = 0; for (const reader of readers) line = (line * 31 + reader().length) % 9973; said.push(line); }
console.log(said.join(" "), parses);
