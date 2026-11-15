// STATISTIC: ArraysGuardedAtLoopHeaders >= 1
// Under: --aot-harden=proof-checks: what the head has asked is held against the cell at every access
'use strict';
const n = +process.argv[2] || 3; const said = [];
function flips(perm) { let count = 0, k; while (!((k = perm[0]) == 0)) { const k2 = (k + 1) >> 1; for (let i = 0; i < k2; i++) { const temp = perm[i]; perm[i] = perm[k - i]; perm[k - i] = temp; } count++; if (count > 50) break; } return count; }
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length;
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
const usual = () => [3, 1, 4, 0, 2, 6, 5];
for (let t = 0; t < n; t++) { said.length = 0; { const l = usual(); said.push(flips(l), show(l)); } const make = () => [3, 1, 4, 0, 2, 6, 5]; const l = make(); said.push(flips(l), show(l), show(make())); }
console.log(said.join("\n"));
