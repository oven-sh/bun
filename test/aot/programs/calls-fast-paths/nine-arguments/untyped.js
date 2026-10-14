"use strict";
function f(a, b, c, d, e, f, g, h, i) { return i; } function g(a, b, c, d, e, f, g, h, i) { return a; }
function few(a, b) { return b; } function few2(a, b) { return a; }
function rest(...r) { return r.length; } function rest2(...r) { return r[8]; }
function run(a, b, n) { let s = 0; for (let i = 0; i < n; i++) { const o = i & 1 ? a : b; s += o(i, 1, 2, 3, 4, 5, 6, 7, 8); } return s; }
module.exports = { f, g, few, few2, rest, rest2, run };
