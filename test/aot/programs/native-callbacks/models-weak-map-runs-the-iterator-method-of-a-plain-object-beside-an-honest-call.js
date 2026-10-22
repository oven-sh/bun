// new WeakMap(..) runs the Symbol.iterator method of a plain object, which the program itself calls once with another receiver and with a number.
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
const values = [[keyA, 1.5], [keyB, item]];
const source = {
  tag: "source",
  [Symbol.iterator](hint) {
    log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
    return values[Symbol.iterator]();
  },
};
source[Symbol.iterator].call({ tag: 7 }, 1);
log.length = 0;
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
