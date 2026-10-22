// new WeakSet(..) runs the getters done and value of a class of the program, of which each result is an instance. Nothing else in the program reaches that code.
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
const keyA = { name: "a" };
const keyB = { name: "b" };
const values = [keyA, item];
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
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
