"use strict";
const sum = (a, b) => (a + b) | 0;
const plusFour = sum.bind(null, 4);
function drive(t, turns) { let s = t & 1; for (let i = 0; i < turns; i++) s = (s + plusFour(i)) | 0; return s & 65535; }
const turns = +(process.argv[2] ?? 50); let all = 0; for (let t = 0; t < turns; t++) all = (all + drive(t, turns)) % 1000003; console.log(all);
