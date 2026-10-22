// new WeakSet(..) runs the Symbol.iterator and next methods of two classes of the program. Nothing else in the program reaches that code.
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
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
