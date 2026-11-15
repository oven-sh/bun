"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
function change(target) { Object.defineProperty(target, "add", { enumerable: false, writable: false }); }
fill(lib);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i) + Object.keys(lib).length; } return s; }
console.log(drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(lib, "add")));
