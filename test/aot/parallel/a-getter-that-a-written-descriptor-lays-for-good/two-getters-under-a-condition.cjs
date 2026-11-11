"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = {};
if (process.argv.length > 90) Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } });
else Object.defineProperty(lib, "add", { enumerable: true, get: function () { return sub; } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)));
