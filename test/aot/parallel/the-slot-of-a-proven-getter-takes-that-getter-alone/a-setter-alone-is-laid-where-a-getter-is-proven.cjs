"use strict";
function add(a, b) { return (a + b) | 0; }
const lib = { base: 1 };
if (process.argv.length > 90) Object.defineProperty(lib, "add", { get: function () { return add; } });
else Object.defineProperty(lib, "add", { set: function (given) {} });
function look(turns) { let s = ""; for (let i = 0; i < turns; i++) s += typeof lib.add + ","; return s; }
console.log(look(+(process.argv[2] ?? 3)));
