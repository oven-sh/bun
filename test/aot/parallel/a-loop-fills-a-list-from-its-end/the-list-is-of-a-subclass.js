'use strict';
class Row extends Array { } function g(a, t) { for (let i = 0; i < 20; i++) a[i] = i * 0.5 + t; return a.length + "|" + a.constructor.name + "|" + a.join(); } function f(t) { return g([], t) + "/" + g(new Row(), t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
