"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = { base: 1 }, spare = { other: 1 };
Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
Object.defineProperty(spare, "add", { enumerable: true, get: function () { return sub; } });
const last = function () { return sub; };
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), spare.add(9, 4), last()(9, 4));
