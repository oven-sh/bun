"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
function fill(target) { target.add = sub; }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
fill(lib);
const early = drive(+(process.argv[2] ?? 50));
Object.defineProperties(lib, { add: { get: function () { return add; } } });
console.log(early, drive(+(process.argv[2] ?? 50)));
