"use strict";
class Point { constructor(x, how) { if (how === 1) Object.freeze(this); if (how === 2) Object.seal(this); if (how === 3) Object.preventExtensions(this); Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
let made = 0, told = new Set();
for (let turn = 0; turn < 4000; turn++) { try { made += new Point(turn & 7, turn % 400 === 399 ? (turn >> 4) % 4 : 0).x; } catch (error) { told.add(error.name + ": " + error.message); } }
console.log(made, [...told].sort().join(" | "));
