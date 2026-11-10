"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 };
const o1 = { p1: 1 }, o2 = { p2: 1 }, o3 = { p3: 1 }, o4 = { p4: 1 }, o5 = { p5: 1 };
for (const record of [o1, o2, o3, o4, o5, lib]) record.add = sub;
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
const early = drive(+(process.argv[2] ?? 50));
Object.defineProperty(lib, "add", { get() { return add; } });
console.log(early, drive(+(process.argv[2] ?? 50)), o3.add(9, 4));
