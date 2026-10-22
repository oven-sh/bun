// new WeakMap(..) runs the Symbol.iterator and next methods of two classes of the program, which the program itself calls once with another receiver and with a number.
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
const values = [[keyA, 1.5], [keyB, item]];
class Steps {
  index = 0;
  tag = "steps";
  next(hint) {
    log.push("next " + (this instanceof Steps) + " " + typeof hint + " " + (this.tag + 1));
    return this.index < values.length ? { done: false, value: values[this.index++] } : { done: true, value: undefined };
  }
}
class Source {
  [Symbol.iterator](hint) {
    log.push("iterator " + (this === source) + " " + typeof hint);
    return new Steps();
  }
}
const source = new Source();
Steps.prototype.next.call({ index: 0.5, tag: 7 }, 1);
log.length = 0;
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
