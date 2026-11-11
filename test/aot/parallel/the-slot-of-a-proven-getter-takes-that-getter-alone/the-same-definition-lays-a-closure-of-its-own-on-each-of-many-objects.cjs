"use strict";
function make(step) { const made = { base: step }; Object.defineProperty(made, "next", { get: function () { return this.base + step; } }); return made; }
const kept = [];
for (let i = 0; i < 40; i++) kept.push(make(i));
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += kept[i % 40].next; return s; }
console.log(drive(+(process.argv[2] ?? 200)));
