"use strict";
function add(a, b) { return (a + b) | 0; }
function twice(a) { return (a * 2) | 0; }
var names = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({ __proto__: null, add: add, twice: twice }, Symbol.toStringTag, { value: "Module" }));
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = names.twice(names.add(s, i)) % 1009; return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.prototype.toString.call(names), Object.keys(names).join(), Object.isFrozen(names));
