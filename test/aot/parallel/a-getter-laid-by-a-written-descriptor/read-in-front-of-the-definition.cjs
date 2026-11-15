"use strict";
const names = {};
function look() { return typeof names.add; }
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) { if (i === turns >> 1) Object.defineProperty(names, "add", { get() { return (a, b) => a + b; } }); s += look()[0]; } return s; }
console.log(drive(+(process.argv[2] ?? 12)));
