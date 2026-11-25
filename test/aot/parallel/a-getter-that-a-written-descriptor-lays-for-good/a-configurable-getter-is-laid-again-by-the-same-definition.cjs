"use strict";
const lib = { base: 1 };
function lay(step) { Object.defineProperty(lib, "next", { configurable: true, get: function () { return this.base + step; } }); }
lay(1);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) lay(100); s += lib.next; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
