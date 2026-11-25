'use strict';
function f(t) { const a = [0.5]; let s = ""; for (let i = 1; i < 12; i++) { a[i] = i * 0.5 + t; s += a[i + 1] + "," + (i + 1 in a) + ";"; } return s; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
