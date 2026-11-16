"use strict";
function add(a, b) { return (a + b) | 0; }
const plus = add.bind(null);
function drive(t, turns) { let s = t & 1; for (let i = 0; i < turns; i++) s = (s + plus(i, t)) | 0; return s; }
const turns = +(process.argv[2] ?? 50); let sum = 0; for (let t = 0; t < turns; t++) sum = (sum + drive(t, turns)) % 1000003; console.log(sum);
