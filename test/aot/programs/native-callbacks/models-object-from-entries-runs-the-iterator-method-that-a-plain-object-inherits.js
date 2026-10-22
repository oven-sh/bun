// Object.fromEntries runs the Symbol.iterator method that a plain object inherits from another. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], ["b", item], ["c", "two"]];
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
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
