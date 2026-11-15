function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const flag = kept("MADE_UP_FLAG", parser);
for (let t = 0; t < 40; t++) { if (t % 8 === 1) process.env.MADE_UP_FLAG = "v" + t; if (t % 8 === 4) delete process.env.MADE_UP_FLAG; if (t % 8 === 6) process.env.MADE_UP_FLAG = "again"; said.push(flag()); }
console.log(said.join(" "), parses);
