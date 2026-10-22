// new Map(..), found by a name put together at run time, runs the next method of a plain object.
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
const steps = {
  index: 0,
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint);
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new globalThis[["Ma", "p"].join("")](source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
