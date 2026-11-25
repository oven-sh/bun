"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
const key = JSON.parse('"add"');
function change(target, at) { Object.defineProperty(target, key, { configurable: true, get() { return (a, b) => a - b + at; } }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib, i); s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
