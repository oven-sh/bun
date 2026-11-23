function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const flag = kept("MADE_UP_NEVER_SET", parser);
for (let t = 0; t < 40; t++) said.push(flag());
console.log(said.join(" "), parses);
