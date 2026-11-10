function kept(name, parser) { let last = {}; let cached; return () => { const raw = process.env[name]; if (raw !== last) { cached = parser(raw); last = raw; } return cached; }; }
let parses = 0; const parser = raw => { parses++; return raw === undefined ? "none" : typeof raw + ":" + String(raw); };
const said = [];
const flag = kept("MADE_UP_FLAG", parser); const stored = [5, true, null, undefined, 1.5, 0n, [1, 2], { toString() { return "text"; } }, "", -0];
for (let t = 0; t < 30; t++) { if (t % 3 === 1) process.env.MADE_UP_FLAG = stored[(t - 1) / 3]; said.push(flag()); }
console.log(said.join(" "), parses);
