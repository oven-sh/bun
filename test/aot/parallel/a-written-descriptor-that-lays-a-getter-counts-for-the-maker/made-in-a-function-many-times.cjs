"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
function make(step) { const made = Object.create(null); made.base = step; Object.defineProperty(made, "next", { get: function () { return this.base + step; } }); return made; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += make(i).next; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
