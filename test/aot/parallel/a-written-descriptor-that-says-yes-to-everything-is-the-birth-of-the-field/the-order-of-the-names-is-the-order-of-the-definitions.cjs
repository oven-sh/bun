"use strict";
class Pair { constructor(a, b, isTurned) { if (isTurned) { Object.defineProperty(this, "b", { enumerable: true, configurable: true, writable: true, value: b }); Object.defineProperty(this, "a", { enumerable: true, configurable: true, writable: true, value: a }); } else { Object.defineProperty(this, "a", { enumerable: true, configurable: true, writable: true, value: a }); Object.defineProperty(this, "b", { enumerable: true, configurable: true, writable: true, value: b }); } } }
let said = 0, told = new Set();
for (let turn = 0; turn < 3000; turn++) { const pair = new Pair(turn & 3, turn & 5, turn % 7 === 0); said = (said + pair.a * 3 + pair.b) % 1000003; told.add(Object.keys(pair).join()); }
console.log(said, [...told].sort().join(" | "));
