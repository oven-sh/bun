// This file asks only for `typeof module.parent`. A class out of a required file is used beside a class with the same text in this file. A turn with the first may cost a few times what a turn with the second costs, not five times.
const Required = require("./counter.cjs");
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
console.log(sums, typeof module.parent);
console.log(required < local * 5 ? "under five times the time" : "over five times the time");
