"use strict";
const lib = { base: 1 };
Object.defineProperty(lib, "later", { enumerable: true, get: async function () { return this.base + 1; } });
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) { const found = lib.later; s += typeof found + typeof found.then + (found === undefined); } return s; }
console.log(drive(+(process.argv[2] ?? 2)));
