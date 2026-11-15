"use strict";
const lib = { base: 2, add(a, b) { return a + b + this.base; } };
Object.defineProperty(lib, "twice", { get() { return this.base * 2; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { s = (lib.add(s, i) + lib.twice) % 100003; if (i === 9) lib.base = 3; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
