"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = {};
Object.assign(lib, { add: sub });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
const early = drive(+(process.argv[2] ?? 50));
Object.defineProperty(lib, "add", { get() { return add; } });
console.log(early, drive(+(process.argv[2] ?? 50)));
