// new Map(..) runs the Symbol.iterator method that a plain object inherits from another. Nothing else in the program reaches that code.
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
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
