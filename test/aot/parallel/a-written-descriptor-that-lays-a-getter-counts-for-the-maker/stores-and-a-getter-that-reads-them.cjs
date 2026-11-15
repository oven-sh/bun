"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
const lib = Object.create(null);
lib.size = 2;
lib.text = "marked";
Object.defineProperty(lib, "shape", { get: function shape() { return this.text.length + this.size; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { s += lib.shape; if (i === 3) lib.size = 5; } return s; }
console.log(drive(+(process.argv[2] ?? 8)), Object.keys(lib).join());
