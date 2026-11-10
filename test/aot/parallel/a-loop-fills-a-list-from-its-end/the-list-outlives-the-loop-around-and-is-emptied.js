'use strict';
function f(t) { const a = []; let s = 0; for (let r = 0; r < 4; r++) { a.length = 0; for (let i = 0; i < 20 - r; i++) a[i] = i * 0.5 + r + t; s += a.length + a[10]; } return s + "|" + a.length + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
