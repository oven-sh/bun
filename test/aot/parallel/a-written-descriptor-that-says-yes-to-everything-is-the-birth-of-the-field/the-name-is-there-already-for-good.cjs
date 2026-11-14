"use strict";
class Base { constructor(isFixed) { if (isFixed) Object.defineProperty(this, "x", { value: -1 }); } }
class Point extends Base { constructor(x, isFixed) { super(isFixed); Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
let made = 0, told = new Set();
for (let turn = 0; turn < 4000; turn++) { try { made += new Point(turn & 7, turn % 500 === 499).x; } catch (error) { told.add(error.name + ": " + error.message); } }
console.log(made, [...told].sort().join(" | "));
