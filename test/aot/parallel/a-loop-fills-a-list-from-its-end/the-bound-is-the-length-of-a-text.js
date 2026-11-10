'use strict';
function g(s, t) { const a = [t]; for (let j = 1; j <= s.length; j++) a[j] = a[j - 1] + s.charCodeAt(j - 1); return a.length + "|" + a.join(); } function f(t) { return g("kitten", t) + "/" + g("", t) + "/" + g("sitting on a fence", t); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
