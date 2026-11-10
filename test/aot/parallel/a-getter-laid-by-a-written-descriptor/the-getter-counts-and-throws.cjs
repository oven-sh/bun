"use strict";
let asked = 0;
const names = {};
Object.defineProperty(names, "add", { get() { if (++asked % 7 === 0) throw new RangeError("seventh"); return asked; } });
function drive(turns) { let s = 0, caught = 0; for (let i = 0; i < turns; i++) { try { s += names.add; } catch (error) { caught += error instanceof RangeError ? 1 : 1000; } } return s + " " + caught; }
console.log(drive(+(process.argv[2] ?? 50)), asked);
