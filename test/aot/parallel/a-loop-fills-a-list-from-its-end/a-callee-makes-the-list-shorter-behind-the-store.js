'use strict';
const ways = { cut(a, i) { if (i === 9) a.length = 4; return 0; }, keep() { return 0; } }; function f(t) { const a = []; let s = 0; for (let i = 0; i < 30; i++) { a[i] = i * 0.5 + t; s += ways[i % 3 ? "keep" : "cut"](a, i) + a.length; } return s + "|" + a.length + "|" + (5 in a) + "|" + a.join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
