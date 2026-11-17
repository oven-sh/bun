"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
function drive(turns) { let s = 1, refused = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) Object.freeze(lib); try { lib.add = lib.add; } catch (error) { refused++; } s = lib.add(s, i); } return s + " " + refused; }
console.log(drive(+(process.argv[2] ?? 50)));
