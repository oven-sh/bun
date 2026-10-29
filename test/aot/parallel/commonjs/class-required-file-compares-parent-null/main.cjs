// This file compares `module.parent` with null and undefined. A class out of a required file is used beside a class with the same text in this file: both are constructed and called without a look by name.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
// COUNT: arrivals <= 300
// COUNT: branches <= 2600
// COUNT: operations <= 300
// COUNT: cells <= 300
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
function local() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Counter().add(i)) | 0;
  return sum;
}
function required() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Required().add(i)) | 0;
  return sum;
}
console.log(local(), required(), module.parent === null, module.parent == null, module.parent === undefined);
