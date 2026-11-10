'use strict';
function make() { return [0.5, 1.5, 2.5]; } function g(a, t) { for (let i = 3; i < 30; i++) a[i] = i * 0.5 + t; return a.length + "|" + a.join(); } function f(t) { const one = g(make(), t); return one + "/" + make().join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
