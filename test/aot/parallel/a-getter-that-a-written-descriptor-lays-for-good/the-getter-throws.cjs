"use strict";
const lib = { left: 3 };
Object.defineProperty(lib, "next", { get() { if (!this.left) throw new RangeError("none left"); return this.left--; } });
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) { try { s += lib.next; } catch (error) { s += error.message; } } return s; }
console.log(drive(+(process.argv[2] ?? 5)));
