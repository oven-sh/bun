// STATISTIC: LoopsBoughtOnceMoreForListsOfAnotherKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every access
"use strict";
const N = 256, a = new Array(N), b = new Array(N); for (let i = 0; i < N; i++) { a[i] = 1762400000000 + i * 1000; b[i] = a[i]; }
function f(t) { for (let i = 0; i < N; i++) b[N - 1 - i] = a[i]; return b[t & 255] % 1009; }
const n = +process.argv[2] || 3; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(Math.abs(sum)), b[0], b[255], b.length);
