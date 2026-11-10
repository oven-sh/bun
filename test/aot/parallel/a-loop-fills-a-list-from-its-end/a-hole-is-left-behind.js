'use strict';
function f(t) { const a = []; for (let i = 0; i < 40; i++) a[i === 7 ? 9 : i] = i * 0.5 + t; return a.length + "|" + (7 in a) + "|" + (8 in a) + "|" + a[9] + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
