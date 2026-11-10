// STATISTIC: ListsAskedInFrontOfTypedCopiesBehindStoresOfTheTurn >= 1
// Under: --aot-harden=proof-checks: what was asked in front is held against the cell at every access
'use strict';
const n = +process.argv[2] || 3; const said = [];
function turn(m, p, q, c, d, n) { for (let k = 0; k < n; k++) { const x = m[p][k], y = m[q][k]; m[p][k] = c * x - d * y; m[q][k] = d * x + c * y; } return m[p][0]; }
const rows = (count, length) => Array.from({ length: count }, (_, i) => Array.from({ length }, (_x, j) => 1 / (i + j + 2)));
const show = m => m.map(r => Array.isArray(r) ? Array.from(r, x => typeof x === "number" ? Math.round(x * 1e6) : String(x)).join(" ") + "#" + r.length : String(r)).join("|");
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
for (let t = 0; t < n; t++) { said.length = 0; { const usual = rows(3, 12); said.push(Math.round(turn(usual, 0, 1, 0.8, 0.6, 12) * 1e9)); } const m = rows(3, 8); const above = Object.create(Array.prototype); const other = [9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5, 9.5]; Object.defineProperty(above, 4, { get() { return 0.125; }, set(v) { m[1] = other; }, configurable: true }); delete m[0][4]; Object.setPrototypeOf(m[0], above); const was = m[1]; said.push(turn(m, 0, 1, 0.8, 0.6, 8), show(m), was.map(x => Math.round(x * 1e6)).join(" ")); }
console.log(said.join("\n"));
