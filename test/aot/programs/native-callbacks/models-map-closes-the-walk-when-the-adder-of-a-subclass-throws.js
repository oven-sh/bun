// new Map(..) in a subclass runs the return method of the iterator when the method set of the subclass throws.
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
const values = [["a", 1.5], ["b", item]];
class Held extends Map {
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value);
    throw new RangeError("full");
  }
}
const steps = {
  index: 0,
  next() {
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
  return(hint) {
    log.push("return " + (this === steps) + " " + typeof hint);
    return {};
  },
};
try {
  const result = new Held({ [Symbol.iterator]: () => steps });
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
