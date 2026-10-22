// new Map(..) runs the getters done and value of a class of the program, of which each result is an instance. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], ["b", item], [item, "two"]];
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
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
