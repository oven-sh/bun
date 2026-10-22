// Iterator.prototype.forEach is given a number in place of a function; whether it runs the return method of its receiver is for plain Bun to say.
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
const values = [1.5];
const steps = {
  index: 0,
  next() {
    log.push("next");
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  },
  return(hint) {
    log.push("return " + (this === steps) + " " + typeof hint);
    return {};
  },
};
try {
  const result = Iterator.prototype.forEach.call(steps, 5);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
