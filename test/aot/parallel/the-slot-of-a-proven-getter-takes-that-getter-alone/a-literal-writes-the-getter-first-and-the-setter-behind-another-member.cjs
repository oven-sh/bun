"use strict";
function make(base) { return { get size() { return this.held * 2; }, held: base, set size(given) { this.held = given; } }; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const made = make(i); made.size = i + 1; s += made.size; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
