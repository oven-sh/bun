"use strict";
function Point(x) { Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); }
let made = 0, told = new Set();
for (let turn = 0; turn < 3000; turn++) { try { if (turn % 500 === 499) Point(turn); else if (turn % 500 === 498) Point.call(7, turn); else if (turn % 500 === 497) { const plain = {}; Point.call(plain, 2); made += plain.x; } else made += new Point(turn & 7).x; } catch (error) { told.add(error.name + ": " + error.message); } }
console.log(made, [...told].sort().join(" | "));
