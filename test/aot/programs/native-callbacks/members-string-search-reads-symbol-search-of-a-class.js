// String.prototype.search reads Symbol.search of what it is given; here the object is an instance of a class whose prototype object has it.
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
  [Symbol.search](text, more) {
    log.push("search " + (this === holder) + " " + typeof text + " " + typeof more);
    return item;
  }
}
const holder = new Holder();
try {
  const result = "text".search(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
