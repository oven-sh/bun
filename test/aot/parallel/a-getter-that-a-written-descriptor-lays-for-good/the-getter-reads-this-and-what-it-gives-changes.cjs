"use strict";
const lib = { base: 2 };
Object.defineProperty(lib, "twice", { get() { return this.base === 2 ? this.base * 2 : "other" + this.base; } });
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) { if (i === 3) lib.base = 5; s += lib.twice; } return s; }
console.log(drive(+(process.argv[2] ?? 6)));
