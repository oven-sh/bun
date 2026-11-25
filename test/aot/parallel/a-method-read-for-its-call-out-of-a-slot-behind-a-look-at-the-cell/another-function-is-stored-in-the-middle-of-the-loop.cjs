"use strict";
const lib = {};
lib.add = function (a, b) { return a + b; };
Object.defineProperty(lib, "marker", { value: true });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) lib.add = function (a, b) { return a - b; }; s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
