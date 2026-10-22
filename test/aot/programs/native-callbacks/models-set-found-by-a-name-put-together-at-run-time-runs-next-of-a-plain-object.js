// new Set(..), found by a name put together at run time, runs the next method of a plain object.
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
const values = [1.5, item, "two"];
const steps = {
  index: 0,
  next(hint) {
    log.push("next " + (this === steps) + " " + typeof hint);
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
};
const source = { [Symbol.iterator]: () => steps };
try {
  const result = new globalThis[["Se", "t"].join("")](source);
  console.log(result.size, [...result].map(value => typeof value).join(), [...result][1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
