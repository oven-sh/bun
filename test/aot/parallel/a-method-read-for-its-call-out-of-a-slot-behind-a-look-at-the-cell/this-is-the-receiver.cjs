"use strict";
const lib = { base: 3 };
lib.add = function (a, b) { return a + b + this.base; };
Object.defineProperty(lib, "marker", { value: true });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { s = lib.add(s, i); if (i === 7) lib.base = 5; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
