"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
function change(target, at) { Object.defineProperty(target, "add", { configurable: true, get() { return (a, b) => a - b + at; } }); }
fill(lib);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib, i); s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
