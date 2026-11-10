"use strict";
function join(a, b) { return a + b; }
const descriptor = { value: join };
const names = Object.create(null, { join: descriptor, other: { value: 1 } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = names.join(s, i) + names.other; return s; }
console.log(drive(+(process.argv[2] ?? 50)), descriptor.value("a", "b"));
