"use strict";
const lib = {};
function fill(target) { target.add = function (a, b) { return a + b; }; Object.defineProperty(target, "marker", { value: true }); }
fill(lib);
function drive(turns) { let s = 1, missed = 0; for (let i = 0; i < turns; i++) { if (i % 7 === 3) delete lib.add; if (i % 7 === 5) lib.add = (a, b) => a + b + 1; try { s = lib.add(s, i); } catch (error) { missed++; } } return s + " " + missed; }
console.log(drive(+(process.argv[2] ?? 50)));
