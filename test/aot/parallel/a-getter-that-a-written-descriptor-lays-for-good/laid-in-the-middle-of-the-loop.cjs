"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = {};
function lay() { Object.defineProperty(lib, "add", { enumerable: true, get: function () { return add; } }); }
function drive(turns) { let s = 1, missed = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) lay(); const found = lib.add; if (found === undefined) missed++; else s = found(s, i); } return s + " " + missed; }
console.log(drive(+(process.argv[2] ?? 50)));
