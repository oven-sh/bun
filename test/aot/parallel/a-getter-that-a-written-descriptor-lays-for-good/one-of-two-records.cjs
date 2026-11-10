"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const first = { tag: 1 }, second = { tag: 2, other: 3 };
function lay(target, given) { Object.defineProperty(target, "run", { get: function () { return given; } }); }
lay(first, add); lay(second, sub);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = (i & 1 ? first : second).run(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)));
