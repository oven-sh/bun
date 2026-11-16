'use strict';
const kept = []; function h(a) { kept[0] = a; a.push(9.5, 8.5, 7.5); } function f(t) { const a = [t + 0.5]; h(a); let s = 0; for (let i = 1; i < 30; i++) { s = s * 2 % 1000003 + a.length; a[i] = i * 0.5; } return s + "|" + a.length + "|" + kept[0].join(); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
