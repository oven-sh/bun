// STATISTIC: LoopsReversionedForOtherIndexingType >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every access
"use strict";
const small = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = i * 3; return l; };
const large = n => { const l = new Array(n); for (let i = 0; i < n; i++) l[i] = 1762400000000 + i * 1000; return l; };
function dup(from) { const n = from.length, into = new Array(n); for (let i = 0; i < n; i++) into[i] = from[i]; return into; }
const rounds = +process.argv[2] || 3, mode = process.argv[3] || "both"; let sum = 0; const a = small(64), b = large(64);
for (let t = 0; t < rounds; t++) { const l = dup(mode === "small" || (mode === "both" && t % 2) ? a : b); sum = (sum + l[t & 63] + l.length) % 1000003; }
console.log(sum, dup(a).join(), dup(b)[63]);
