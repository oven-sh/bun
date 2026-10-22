// new WeakSet(..) runs the return method of a plain object, when the walk ends early, which the program itself calls once with another receiver and with a number.
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
const values = [keyA, "text", item];
const steps = {
  index: 0,
  tag: "steps",
  next() {
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
  return(hint) {
    log.push("return " + (this === steps) + " " + typeof hint + " " + (this.tag + 1));
    return {};
  },
};
const source = { [Symbol.iterator]: () => steps };
steps.return.call({ index: 0.5, tag: 7 }, 1);
log.length = 0;
steps.index = 0;
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
