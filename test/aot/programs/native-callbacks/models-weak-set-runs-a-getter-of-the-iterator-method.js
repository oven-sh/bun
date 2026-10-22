// new WeakSet(..) runs a getter under Symbol.iterator of a plain object, and the function it answers with. Nothing else in the program reaches that code.
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
  get [Symbol.iterator]() {
    log.push("get iterator " + (this === source));
    return function (hint) {
      log.push("iterator " + (this === source) + " " + typeof hint);
      return values[Symbol.iterator]();
    };
  },
};
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
