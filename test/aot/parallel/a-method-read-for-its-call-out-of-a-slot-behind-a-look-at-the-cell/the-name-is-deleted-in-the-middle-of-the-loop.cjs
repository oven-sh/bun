"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
function change(target) { delete target.add; }
fill(lib);
function drive(turns) { let s = 1; try { for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i); } } catch (error) { return s + " " + error.constructor.name; } return s + " none"; }
console.log(drive(+(process.argv[2] ?? 50)));
