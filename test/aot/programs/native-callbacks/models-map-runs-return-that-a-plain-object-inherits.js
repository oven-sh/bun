// new Map(..) runs the return method that the iterator inherits from a plain object, when the walk ends early. Nothing else in the program reaches that code.
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
const values = [["a", 1.5], 5, ["b", item]];
const steps = {
  __proto__: {
    tag: "above",
    return(hint) {
      log.push("return " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
      return {};
    },
  },
  index: 0,
  next() {
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
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
