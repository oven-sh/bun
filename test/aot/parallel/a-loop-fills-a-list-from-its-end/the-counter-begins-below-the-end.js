'use strict';
function f(t) { const a = [t + 0.5, 1.5, 2.5, 3.5, 4.5]; for (let i = 2; i < 40; i++) a[i] = i * 0.25; return a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
