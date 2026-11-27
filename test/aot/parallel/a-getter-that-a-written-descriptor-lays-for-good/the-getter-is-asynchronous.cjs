"use strict";
const lib = { base: 1 };
Object.defineProperty(lib, "later", { enumerable: true, get: async function () { return this.base + 1; } });
async function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += await lib.later; return s + " " + (lib.later instanceof Promise); }
drive(+(process.argv[2] ?? 5)).then(said => console.log(said));
