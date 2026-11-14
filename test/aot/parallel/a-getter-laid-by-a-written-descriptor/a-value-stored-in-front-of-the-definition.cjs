"use strict";
const names = {};
names.add = 5;
function look() { return names.add; }
const before = look();
Object.defineProperty(names, "add", { get() { return 7; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += look(); return s; }
console.log(before, drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(names, "add")));
