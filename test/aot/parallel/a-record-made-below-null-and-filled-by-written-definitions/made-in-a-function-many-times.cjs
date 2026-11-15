"use strict";
function make(base) { const made = Object.create(null); Object.defineProperty(made, "base", { value: base }); Object.defineProperty(made, "next", { value(by) { return this.base + by; } }); return made; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const made = make(i); s = (s + made.next(2) + made.base) | 0; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
