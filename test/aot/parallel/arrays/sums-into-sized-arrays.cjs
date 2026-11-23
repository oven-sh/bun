// STATISTIC: SizedSumArraysWithProfiles >= 2
// `sums[i + 1] = sums[i] + list[i]` in new Array(n + 1): numbers, or strings where the list holds one.
"use strict";
const own = a => { let s = a.length + ":"; for (let k = 0; k < a.length; k++) s += Object.prototype.hasOwnProperty.call(a, k) ? (typeof a[k] === "string" ? JSON.stringify(a[k]) : a[k]) + "," : "_,"; return s; };
const lists = new Map([["numbers", [3, 1, 4, 1, 5]], ["fractions", [0.5, 1.25, -2]], ["strings", ["a", "b"]], ["mixed", [1, 2, "three", 4]], ["holes", [1, , 3]], ["large", [2 ** 30, 2 ** 30, 2 ** 30]], ["bigints", [1n]], ["objects", [{ valueOf() { return 7; } }, 1]], ["empty", []]]);
function sums(w) { const n = w.length; const p = new Array(n + 1); p[0] = 0; for (let i = 0; i < n; i++) { p[i + 1] = p[i] + w[i]; } let best = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j <= n; j++) if (p[j] - p[i] > best) best = p[j] - p[i]; return own(p) + best; }
function products(w) { const n = w.length; const p = Array(n + 2); p[0] = 1; p[1] = 1; for (let i = 0; i < n; i++) p[i + 2] = p[i + 1] + w[i] + p[i]; return own(p); }
for (let round = 0; round < 3; round++) for (const [name, w] of lists) for (const f of [sums, products]) { let r; try { r = f(w); } catch (e) { r = e.constructor.name; } console.log(name, r); }
