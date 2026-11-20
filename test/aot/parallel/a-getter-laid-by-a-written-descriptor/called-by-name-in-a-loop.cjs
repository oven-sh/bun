"use strict";
function add(a, b) { return (a + b) | 0; }
const names = {};
Object.defineProperty(names, "add", { enumerable: true, get: function () { return add; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + names.add(i, turns)) | 0; return s; }
console.log(drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(names, "add")), Object.keys(names).join());
