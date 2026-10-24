// One required file asks whether exports and module are what a CommonJS file has, and only then requires a library module through the module object, inside a try. A class out of a third file, which has nothing to do with it, is used beside a class with the same text in this file. A turn with the first may cost a few times what a turn with the second costs, not five times.
const Required = require("./counter.cjs");
const isMap = require("./is-map.cjs");
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
let sums = 0;
const local = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 2_000_000; i++) sum = (sum + new Counter().add(i)) | 0;
  sums = (sums + sum) | 0;
});
const required = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 2_000_000; i++) sum = (sum + new Required().add(i)) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, isMap(new Map()), isMap(new Required()));
console.log(required < local * 5 ? "under five times the time" : "over five times the time");
