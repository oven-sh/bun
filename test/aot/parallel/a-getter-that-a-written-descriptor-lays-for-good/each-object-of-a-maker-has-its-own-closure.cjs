"use strict";
function make(step) { const made = { base: 1 }; Object.defineProperty(made, "next", { enumerable: true, get: function () { return this.base + step; } }); return made; }
const one = make(1), ten = make(10);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += one.next + ten.next; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
