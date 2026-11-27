"use strict";
function make(base) { return Object.create(null, { base: { value: base }, next: { value: function (by) { return this.base + by; } } }); }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const made = make(i); s = (s + made.next(2) + made.base) | 0; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
