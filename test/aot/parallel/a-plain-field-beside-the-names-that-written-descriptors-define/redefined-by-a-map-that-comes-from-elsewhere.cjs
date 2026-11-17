"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
const maps = [{ add: { configurable: true, get() { return (a, b) => a * 2 - b; } } }];
function change(target) { Object.defineProperties(target, maps[JSON.parse("0")]); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i) % 100003; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
