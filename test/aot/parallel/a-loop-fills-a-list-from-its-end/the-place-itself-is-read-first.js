'use strict';
function f(t) { const a = []; let s = ""; for (let i = 0; i < 12; i++) { s += a[i] + ","; a[i] = i * 0.5 + t; s += a[i] + ";"; } return s; }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
