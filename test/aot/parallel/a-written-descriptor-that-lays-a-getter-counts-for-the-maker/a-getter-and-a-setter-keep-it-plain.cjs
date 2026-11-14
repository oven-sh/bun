"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = Object.create(null);
lib.held = 1;
Object.defineProperty(lib, "value", { get: function () { return this.held; }, set: function (given) { this.held = given * 2; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { lib.value = i; s += lib.value; } return s; }
console.log(drive(+(process.argv[2] ?? 6)));
