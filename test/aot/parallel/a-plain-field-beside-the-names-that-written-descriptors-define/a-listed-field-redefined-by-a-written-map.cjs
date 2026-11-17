"use strict";
const lib = { add: function (a, b) { return a + b; }, base: 1 };
Object.defineProperty(lib, "marker", { value: true });
function change(target) { Object.defineProperties(target, { add: { value: (a, b) => a - b, enumerable: false }, base: { get() { return 2; } } }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i) + lib.base; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
