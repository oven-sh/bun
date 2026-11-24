'use strict';
function f(t) { const a = [t + 0.5]; for (let i = 3; i < 40; i++) a[i] = i * 0.5; return a.length + "|" + (1 in a) + "|" + (2 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
