"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
function change(target) { Object.defineProperty(target, "add", { get() { return (a, b) => a * 2 - b; } }); }
fill(lib);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i) % 100003; return s; }
const turns = +(process.argv[2] ?? 50), first = drive(turns);
change(lib);
console.log(first, drive(turns));
