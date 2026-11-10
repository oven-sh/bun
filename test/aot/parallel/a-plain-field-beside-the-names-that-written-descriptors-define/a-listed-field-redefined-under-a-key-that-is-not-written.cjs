"use strict";
const lib = { add: function (a, b) { return a + b; }, base: 1 };
Object.defineProperty(lib, "marker", { value: true });
const key = JSON.parse('"add"');
function change(target) { Object.defineProperty(target, key, { get() { return (a, b) => a - b; } }); }
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) { if (i === turns >> 1) change(lib); s = lib.add(s, i) + lib.base; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
