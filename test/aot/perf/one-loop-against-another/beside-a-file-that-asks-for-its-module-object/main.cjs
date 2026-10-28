// One required file asks whether exports and module are what a CommonJS file has, and only then requires a library module through the module object, inside a try. A class out of a third file, which has nothing to do with it, is used beside a class with the same text in this file.
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
function withOwn(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Counter().add(i)) | 0;
  return sum;
}
function withRequired(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Required().add(i)) | 0;
  return sum;
}
const [loop = "a class out of a required file", turns = "5000"] = process.argv.slice(2);
console.log(withOwn(5000), withRequired(5000), (loop === "a class out of a required file" ? withRequired : withOwn)(Number(turns)), isMap(new Map()), isMap(new Required()));
