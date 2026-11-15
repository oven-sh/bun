"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(lib, "add")), Object.keys(lib).join());
