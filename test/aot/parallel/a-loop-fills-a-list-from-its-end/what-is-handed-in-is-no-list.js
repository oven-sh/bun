'use strict';
function g(a, t) { for (let i = 0; i < 20; i++) a[i] = i * 0.5 + t; return a.length + "|" + Object.keys(a).length; } function f(t) { return g([], t) + "/" + g({ length: 3 }, t) + "/" + g(new Float64Array(8), t) + "/" + g(new Proxy([], {}), t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
