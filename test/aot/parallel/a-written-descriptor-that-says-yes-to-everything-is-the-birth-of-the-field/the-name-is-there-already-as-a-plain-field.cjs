"use strict";
class Point { constructor(x) { this.y = 1; this.x = -5; this.z = 2; Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
function use(turn) { let sum = turn & 1; for (let i = 0; i < 64; i++) { const point = new Point(i); sum += point.x + point.y + point.z; } return sum; }
let said = 0; for (let turn = 0; turn < 2000; turn++) said = (said + use(turn)) % 1000003;
console.log(said, Object.keys(new Point(1)).join());
