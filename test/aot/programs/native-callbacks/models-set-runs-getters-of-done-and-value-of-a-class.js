// new Set(..) runs the getters done and value of a class of the program, of which each result is an instance. Nothing else in the program reaches that code.
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
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new Set(source);
  console.log(result.size, [...result].map(value => typeof value).join(), [...result][1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
