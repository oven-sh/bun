"use strict";
class Counter {
  step() {
    return (module.exports.count *= 2);
  }
}
globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("first runs", globalThis.runs);
exports.count = 3;
exports.Counter = Counter;
eval("0");
if (globalThis.runs < 3) throw new Error("first threw");
