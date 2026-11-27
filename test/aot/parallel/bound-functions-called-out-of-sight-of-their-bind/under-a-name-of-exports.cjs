"use strict";
function add(a, b) { return (a + b) | 0; }
function low(a) { return this === exports ? a & 15 : -1; }
exports.add = add.bind(null);
exports.low = low.bind(exports);
function drive(t, turns) { let s = t & 1; for (let i = 0; i < turns; i++) s = (s + exports.add(i, t) + exports.low(i)) | 0; return s; }
const turns = +(process.argv[2] ?? 50); let sum = 0; for (let t = 0; t < turns; t++) sum = (sum + drive(t, turns)) % 1000003; console.log(sum);
