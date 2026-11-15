"use strict";
function table(k) { const T = []; for (let y = 0; y < 6; y++) { const row = []; for (let x = 0; x < 6; x++) row.push(k ? (y + x) / 2 : y * 3 + x); T.push(row); } return T; }
function show(x, depth = 0) { if (depth > 3) return "deep"; if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length && i < 12; i++) s += (i ? "," : "") + (i in x ? show(x[i], depth + 1) : "hole"); return s + "]"; } return Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{}" : String(x); }
const other = [9, 9, 9, 9, 9, 9];
function run(T, a, n, r) { let s = 0; for (let i = 0; i < n; i++) { a[i] = i * 1.5; s += T[r][i]; } return s; }
function tell(f, T, a) { let said; try { said = f(); } catch (e) { said = e.name; } console.log(show(said), show(T), show(a)); }
for (const k of [0, 1]) for (let round = 0; round < 3; round++) { { const T = table(k), a = table(1 - k); tell(() => run(T, a, 5, 1), T, a); } if (round) { const T = table(k), a = T; tell(() => run(T, a, 5, 1), T, a); } }
