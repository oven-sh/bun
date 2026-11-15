"use strict";
function add(a, b) { return (a + b) | 0; }
function sub(a, b) { return (a - b) | 0; }
function Tool(base) { this.base = base; }
Object.defineProperties(Tool.prototype, { add: { get: function () { return this.base > 2 ? add : sub; } } });
const lib = new Tool(3), other = new Tool(1);
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = lib.add(s, i); return s; }
console.log(drive(+(process.argv[2] ?? 50)), other.add(9, 4));
