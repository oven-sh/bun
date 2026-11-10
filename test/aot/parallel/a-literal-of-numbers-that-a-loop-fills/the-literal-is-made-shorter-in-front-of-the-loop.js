'use strict';
function f(t) { const a = [t + 0.5, 1.5]; a.length = 1; let s = 0; for (let i = 2; i < 30; i++) { s += a.length; a[i] = i * 0.5; } return s + "|" + a.length + "|" + (1 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
