// Iterator.prototype.forEach runs the getters done and value of a class of the program, of which each result is an instance, its receiver. Nothing else in the program reaches that code.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
const values = [1.5, item, "two"];
const seen = [];
class Result {
  constructor(at) {
    this.at = at;
  }
  get done() {
    log.push("get done " + this.at);
    return this.at >= values.length;
  }
  get value() {
    log.push("get value " + this.at);
    return values[this.at];
  }
}
const steps = {
  index: 0,
  next() {
    return new Result(this.index++);
  },
};
try {
  const result = Iterator.prototype.forEach.call(steps, (value, index) => {
    seen.push(typeof value + index);
    if (typeof value === "object") seen.push(value.double());
  });
  console.log(result, seen.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
