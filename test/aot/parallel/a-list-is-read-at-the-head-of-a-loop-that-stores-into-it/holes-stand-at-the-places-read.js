// STATISTIC: ListsAskedAtHeadsOfTypedTurns >= 1
// Under: --aot-harden=proof-checks: the position of every read is held against the length of its list
'use strict';
const n = +process.argv[2] || 3; const said = [];
function flips(perm) { let count = 0, k; while (!((k = perm[0]) == 0)) { const k2 = (k + 1) >> 1; for (let i = 0; i < k2; i++) { const temp = perm[i]; perm[i] = perm[k - i]; perm[k - i] = temp; } count++; if (count > 20) break; } return count; }
const show = l => Array.from(l, x => String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).join();
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
for (let t = 0; t < n; t++) { said.length = 0; { const l = [3, 1, 4, 0, 2, 6, 5]; said.push(flips(l), show(l)); } { const l = [3, , 4, 0, 2]; said.push(tried(() => flips(l)), show(l)); } { const l = [4, 1, 2, 3, , 0]; said.push(tried(() => flips(l)), show(l)); } { const l = [2, 1, 0]; l.length = 2; said.push(tried(() => flips(l)), show(l)); } { const l = [5, 1, 2]; l.length = 8; said.push(tried(() => flips(l)), show(l)); } }
console.log(said.join("\n"));
