"use strict";
const lib = { held: 1 };
Object.defineProperty(lib, "value", { get() { return this.held; }, set(given) { this.held = given * 2; } });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { lib.value = i; s += lib.value; } return s; }
console.log(drive(+(process.argv[2] ?? 6)));
