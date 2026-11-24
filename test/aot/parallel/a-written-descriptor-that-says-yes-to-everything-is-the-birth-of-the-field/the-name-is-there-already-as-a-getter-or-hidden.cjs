"use strict";
class Base { constructor(how) { if (how === 1) Object.defineProperty(this, "x", { configurable: true, get() { return -1; } }); if (how === 2) Object.defineProperty(this, "x", { configurable: true, value: -2 }); } }
class Point extends Base { constructor(x, how) { super(how); Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
let made = 0, told = new Set();
for (let turn = 0; turn < 4000; turn++) { const point = new Point(turn & 7, turn % 300 === 299 ? 1 + ((turn >> 3) & 1) : 0); made += point.x; told.add(JSON.stringify(Object.getOwnPropertyDescriptor(point, "x")).replace(/"value":\d+/, "value") + Object.keys(point).join()); }
console.log(made, [...told].sort().join(" | "));
