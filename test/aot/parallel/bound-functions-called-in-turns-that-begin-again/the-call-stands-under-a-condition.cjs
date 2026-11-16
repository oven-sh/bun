"use strict";
function add(a, b) { return (a + b) | 0; }
function drive(bound, turns) { let s = 7; for (let i = 0; i < turns; i++) { if (i > turns) s = (s + bound(i, 1)) | 0; else if (i & 1) s = (s + plus(i, 2)) | 0; } return s; }
const turns = +(process.argv[2] ?? 50), plus = add.bind(null);
console.log(drive(5, turns), drive(plus, turns), drive(undefined, turns));
