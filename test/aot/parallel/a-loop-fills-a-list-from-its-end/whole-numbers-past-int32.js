'use strict';
function f(t) { const a = []; for (let i = 0; i < 40; i++) a[i] = (i + t) * 100000000; return a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
