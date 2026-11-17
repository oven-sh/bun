"use strict";
const lib = { base: 1 }, spare = { other: 1 };
Object.defineProperty(lib, "size", { enumerable: true, get: function () { return 7; } });
Object.defineProperty(spare, "size", { enumerable: true, get: function () { return 9; } });
const last = function () { return 9; };
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += lib.size; return s; }
console.log(drive(+(process.argv[2] ?? 50)), spare.size, last());
