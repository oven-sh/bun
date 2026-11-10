"use strict";
var has = Object.prototype.hasOwnProperty;
function meet(one, two) { var both = 0, name; for (name in one) { if (has.call(two, name)) both += 1; if (has.call(one, name + "x")) both += 10; if (has.call(one, "b")) both += 100; } return both; }
let said = 0; for (let turn = 0; turn < 8000; turn++) said = (said + meet({ a: 1, b: 2, ax: 3 }, turn & 1 ? { b: 1 } : { a: 1, c: 2 })) % 1000003;
console.log(said);
