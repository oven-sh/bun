"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = { base: 1 };
function fill(target) { target.add = null; }
fill(lib);
const early = String(lib.add);
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(early, drive(+(process.argv[2] ?? 50)));
