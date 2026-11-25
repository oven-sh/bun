'use strict';
function f(t) { const a = [t, 7]; const first = a[0] + a[1]; for (let i = 2; i < 30; i++) a[i] = a[i - 1] * 0.5 + first; return a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
