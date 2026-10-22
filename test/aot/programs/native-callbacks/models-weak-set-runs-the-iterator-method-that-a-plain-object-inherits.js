// new WeakSet(..) runs the Symbol.iterator method that a plain object inherits from another. Nothing else in the program reaches that code.
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
const source = {
  __proto__: {
    tag: "above",
    [Symbol.iterator](hint) {
      log.push("iterator " + (this === source) + " " + typeof hint + " " + (this.tag + 1));
      return values[Symbol.iterator]();
    },
  },
};
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
