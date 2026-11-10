'use strict';
function f(t) { const a = []; let s = 0; for (let i = 0; i < 40; i++) { s += a.length; a[i] = i * 0.5 + t; s += a.length * 100; } return s + "|" + a.length; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
