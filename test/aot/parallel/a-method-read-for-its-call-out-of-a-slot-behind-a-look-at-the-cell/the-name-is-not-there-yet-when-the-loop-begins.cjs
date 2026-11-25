"use strict";
const lib = {};
Object.defineProperty(lib, "marker", { value: true });
function fill() { lib.add = function (a, b) { return a + b; }; }
function drive(turns) { let s = 1, missed = 0; for (let i = 0; i < turns; i++) { if (i === 3) fill(); try { s = lib.add(s, i); } catch (error) { missed += error instanceof TypeError ? 1 : 1000; } } return s + " " + missed; }
console.log(drive(+(process.argv[2] ?? 50)));
