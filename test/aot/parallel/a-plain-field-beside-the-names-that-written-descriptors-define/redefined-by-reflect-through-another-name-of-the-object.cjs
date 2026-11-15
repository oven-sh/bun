"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
const holder = { held: lib };
function change(from) { return Reflect.defineProperty(from.held, "add", { get() { return (a, b) => a + b + 1; }, configurable: true }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) s += change(holder) ? 1000 : 0; s = lib.add(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
