"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = { add: null };
const early = String(lib.add);
Object.defineProperty(lib, "add", { enumerable: true, get() { return add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(early, drive(+(process.argv[2] ?? 50)));
