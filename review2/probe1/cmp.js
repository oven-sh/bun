const fs = require("fs");
function parse(f) { const m = new Map(); for (const l of fs.readFileSync(f, "utf8").split("\n")) { const r = /^\((pass|fail)\) (.*) \[([0-9.]+)(ms|s)\]$/.exec(l); if (r) m.set(r[2], { st: r[1], ms: r[4] === "s" ? +r[3] * 1000 : +r[3] }); } return m; }
const a = parse(process.argv[2]), b = parse(process.argv[3]);
let rows = [], ta = 0, tb = 0;
for (const [k, v] of a) { const w = b.get(k); if (!w) continue; if (v.st === "pass" && w.st === "pass") { ta += v.ms; tb += w.ms; rows.push([w.ms - v.ms, v.ms, w.ms, k]); } }
rows.sort((x, y) => y[0] - x[0]);
console.log("tests passing on both:", rows.length, "sum base", Math.round(ta), "ms; sum arm", Math.round(tb), "ms");
for (const r of rows.slice(0, 14)) console.log((r[0] > 0 ? "+" : "") + Math.round(r[0]) + " ms", Math.round(r[1]) + " -> " + Math.round(r[2]), r[3].slice(0, 130));
console.log("...");
for (const r of rows.slice(-4)) console.log((r[0] > 0 ? "+" : "") + Math.round(r[0]) + " ms", Math.round(r[1]) + " -> " + Math.round(r[2]), r[3].slice(0, 130));
