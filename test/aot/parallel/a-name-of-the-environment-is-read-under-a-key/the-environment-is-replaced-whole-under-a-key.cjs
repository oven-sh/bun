function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const K = JSON.parse('["env"]'); process.env.MADE_UP_FLAG = "first"; const host = process.env; const flag = kept("MADE_UP_FLAG", parser);
for (let t = 0; t < 40; t++) { if (t === 7) process[K[0]] = { MADE_UP_FLAG: "second" }; if (t === 15) process[K[0]] = {}; if (t === 22) process[K[0]] = { ...host, MADE_UP_FLAG: "third" }; if (t === 31) process[K[0]] = host; said.push(flag()); }
console.log(said.join(" "), parses);
