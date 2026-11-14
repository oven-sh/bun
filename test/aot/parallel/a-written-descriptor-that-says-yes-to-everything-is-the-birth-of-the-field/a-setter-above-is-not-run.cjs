"use strict";
let calls = 0;
class Base { set x(value) { calls++; } get x() { return -1; } }
class Point extends Base { constructor(x) { super(); Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
function use(turn) { let sum = turn & 1; for (let i = 0; i < 64; i++) { const point = new Point(i); sum += point.x; } return sum; }
let said = 0; for (let turn = 0; turn < 2000; turn++) said = (said + use(turn)) % 1000003;
console.log(said, calls, Object.hasOwn(new Point(1), "x"));
