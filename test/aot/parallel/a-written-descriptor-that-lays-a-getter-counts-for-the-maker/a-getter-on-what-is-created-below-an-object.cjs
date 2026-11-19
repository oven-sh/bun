"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const parent = { base: 7, add: sub };
const lib = Object.create(parent);
const early = lib.add(9, 4);
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return this.base > 2 ? add : sub; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(early, drive(+(process.argv[2] ?? 50)), Object.getPrototypeOf(lib) === parent);
