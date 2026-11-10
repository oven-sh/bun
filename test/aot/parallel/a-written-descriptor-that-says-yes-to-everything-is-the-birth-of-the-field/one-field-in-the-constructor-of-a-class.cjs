"use strict";
class Point { constructor(x) { Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
function use(turn) { let sum = turn & 1; for (let i = 0; i < 64; i++) { const point = new Point(i); sum += point.x; } return sum; }
let said = 0; for (let turn = 0; turn < 3000; turn++) said = (said + use(turn)) % 1000003;
console.log(said, JSON.stringify(Object.getOwnPropertyDescriptor(new Point(4), "x")));
