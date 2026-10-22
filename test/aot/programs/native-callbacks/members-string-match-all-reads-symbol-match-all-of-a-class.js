// String.prototype.matchAll reads Symbol.matchAll of what it is given; here the object is an instance of a class whose prototype object has it.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
class Holder {
  [Symbol.matchAll](text, more) {
    log.push("matchAll " + (this === holder) + " " + typeof text + " " + typeof more);
    return item;
  }
}
const holder = new Holder();
try {
  const result = "text".matchAll(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
