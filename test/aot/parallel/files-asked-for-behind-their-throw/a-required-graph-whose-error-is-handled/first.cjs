class Counter {
  step() {
    return (module.exports.count *= 2);
  }
}
globalThis.runs = (globalThis.runs ?? 0) + 1;
console.log("first runs", globalThis.runs);
globalThis.retry = () => require("./first.cjs");
exports.count = 3;
exports.Counter = Counter;
if (globalThis.runs < 2) throw new Error("first threw");
