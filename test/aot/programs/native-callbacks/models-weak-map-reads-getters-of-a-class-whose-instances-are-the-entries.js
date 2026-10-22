// new WeakMap(..) reads the members 0 and 1 of each entry; here the entries are instances of a class that has two getters under those names.
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
class Pair {
  constructor(name, held) {
    this.name = name;
    this.held = held;
  }
  get 0() {
    log.push("get 0 " + typeof this.held);
    return this.name;
  }
  get 1() {
    log.push("get 1 " + typeof this.held);
    return this.held;
  }
}
const source = [new Pair(keyA, 1.5), new Pair(keyB, item)];
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
