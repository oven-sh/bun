"use strict";
const above = { add(a, b) { return a * 2 + b; } };
const lib = Object.create(above);
lib.add = function (a, b) { return a + b; };
Object.defineProperty(lib, "marker", { value: true });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns - 5) delete lib.add; s = lib.add(s, i) % 100003; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
