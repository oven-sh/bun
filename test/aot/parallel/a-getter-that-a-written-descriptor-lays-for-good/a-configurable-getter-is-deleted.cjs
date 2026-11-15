"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
Object.defineProperty(lib, "add", { configurable: true, get: function () { return add; } });
function drive(turns) { let s = 1, missed = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) delete lib.add; try { s = lib.add(s, i); } catch (error) { missed++; } } return s + " " + missed; }
console.log(drive(+(process.argv[2] ?? 50)));
