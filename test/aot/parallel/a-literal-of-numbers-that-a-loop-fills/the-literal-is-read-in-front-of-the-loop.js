// STATISTIC: ArrayLiteralsAllocatedForLoops = 0
'use strict';
function f(t) { const a = [t + 0.5]; const first = a[0] * 2; for (let i = 1; i < 30; i++) a[i] = a[i - 1] + first; return a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
