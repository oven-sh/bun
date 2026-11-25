"use strict";
function join(a, b) { return a + b; }
const names = Object.create(null, { join: { value: join } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = names.join(s, i); return s; }
const taken = Object.getOwnPropertyDescriptor(names, "join").value;
console.log(drive(+(process.argv[2] ?? 50)), taken("a", 1), names.join("x", "y"), join([1], 2));
