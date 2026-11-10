"use strict";
class Point { constructor(x) { this.same = Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }) === this; } }
function make(x) { return Object.defineProperty({ y: 1 }, "x", { enumerable: true, configurable: true, writable: true, value: x }); }
let said = 0; for (let turn = 0; turn < 3000; turn++) { const point = new Point(turn & 7), other = make(turn & 3); said += point.x + (point.same ? 1 : 100) + other.x + other.y; }
console.log(said, Object.keys(make(1)).join(), Object.keys(new Point(1)).join());
