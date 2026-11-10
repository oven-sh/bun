// STATISTIC: ListsAskedInFrontOfTypedCopiesBehindStoresOfTheTurn >= 1
// Under: --aot-harden=proof-checks: what was asked in front is held against the cell at every access
'use strict';
const n = +process.argv[2] || 3; const said = [];
function turn(m, p, q, c, d, n) { for (let k = 0; k < n; k++) { const x = m[p][k], y = m[q][k]; m[p][k] = c * x - d * y; m[q][k] = d * x + c * y; } return m[p][0]; }
const rows = (count, length) => Array.from({ length: count }, (_, i) => Array.from({ length }, (_x, j) => 1 / (i + j + 2)));
const show = m => m.map(r => Array.isArray(r) ? Array.from(r, x => typeof x === "number" ? Math.round(x * 1e6) : String(x)).join(" ") + "#" + r.length : String(r)).join("|");
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
for (let t = 0; t < n; t++) { said.length = 0; { const usual = rows(3, 12); said.push(Math.round(turn(usual, 0, 1, 0.8, 0.6, 12) * 1e9)); } const m = rows(3, 12); said.push(turn(m, 1, 1, 0.8, 0.6, 12), show(m)); }
console.log(said.join("\n"));
