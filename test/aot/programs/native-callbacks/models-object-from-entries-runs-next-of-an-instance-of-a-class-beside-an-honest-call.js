// Object.fromEntries runs the Symbol.iterator and next methods of two classes of the program, which the program itself calls once with another receiver and with a number.
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
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
