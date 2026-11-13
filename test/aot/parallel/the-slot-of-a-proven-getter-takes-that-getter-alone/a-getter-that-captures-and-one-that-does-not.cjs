"use strict";
function make(step) { return { get next() { return step + 1; }, get seven() { return 7; } }; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const made = make(i); s += made.next + made.seven; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
