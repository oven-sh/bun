"use strict";
function make() { return {}; }
const first = make(), second = make(), third = make();
Object.defineProperty(first, "add", { get() { return (a, b) => a + b; } });
Object.defineProperty(second, "add", { get() { return (a, b) => a * b; } });
function drive(names, turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + (names.add ? names.add(i, 3) : -1)) | 0; return s; }
const turns = +(process.argv[2] ?? 50);
console.log(drive(first, turns), drive(second, turns), drive(third, turns));
