"use strict";
function add(a, b) { return (a + b) | 0; }
const names = { __proto__: null };
Object.defineProperty(names, "add", { value: add });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = names.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.getPrototypeOf(names), "toString" in names);
