// STATISTIC: SumsOfIntegersInTurnsLaidOut >= 1
// Under: --aot-testing=EmittersAloneTestEveryPosition: the turns are laid out as users build them, and every raw access asks its position at the run
"use strict";
function fresh(n, hole) { const l = []; for (let k = 0; k < n; k++) l.push(k * 3 + 1); if (hole >= 0 && hole < n) { const c = l.slice(); c.length = hole; c[n - 1] = l[n - 1]; for (let k = hole + 1; k < n - 1; k++) c[k] = l[k]; return hole === n - 1 ? (c.length = n - 1, c.length = n, c) : c; } return l; }
function sum(l) { let s = 0; for (let i = 0; i < l.length; i++) s += l[i]; return s; }
function over(l, b) { let c = 0; for (let i = 0; i < l.length; i++) { if (l[i] > b) c++; } return c; }
const out = [];
for (const n of [0, 1, 3, 7, 8, 9, 16, 17, 31]) for (const hole of [-1, 0, 1, n >> 1, n - 2, n - 1]) { const l = fresh(n, hole); out.push(n + ":" + hole + ":" + sum(l) + ":" + over(l, n)); }
console.log(out.join(" "));
