function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const N = JSON.parse('["MADE_UP_FLAG"]'); const flag = kept(N[0], parser);
for (let t = 0; t < 40; t++) { if (t % 8 === 1) process.env[N[0]] = "v" + t; if (t % 8 === 4) delete process.env[N[0]]; if (t % 8 === 6) process.env[N[0]] = "again"; said.push(flag()); }
console.log(said.join(" "), parses);
