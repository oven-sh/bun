"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = { base: 1 };
Object.defineProperty(lib, "all", { enumerable: true, get: function* () { yield add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { for (const found of lib.all) s = found(s, i); } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
