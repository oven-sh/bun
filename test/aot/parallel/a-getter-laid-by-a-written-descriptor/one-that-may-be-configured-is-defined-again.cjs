"use strict";
const names = {};
Object.defineProperty(names, "add", { configurable: true, get() { return 1; } });
function look() { return names.add; }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) Object.defineProperty(names, "add", { configurable: true, get() { return 100; } }); if (i === turns - 2) Object.defineProperty(names, "add", { value: 10000 }); s += look(); } return s; }
console.log(drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(names, "add")));
