"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
function change(target) { Object.defineProperty(target, "add", { enumerable: false, value: (a, b) => a - b }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
