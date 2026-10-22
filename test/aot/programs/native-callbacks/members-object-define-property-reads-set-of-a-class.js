// Object.defineProperty reads set of what it is given; here the object is an instance of a class whose prototype object has it.
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
const target = {};
class Holder {
  configurable = true;
  enumerable = true;
  set(value) {
    log.push("runs set " + (this === target) + " " + typeof value);
    kept.push(value);
  }
}
const holder = new Holder();
try {
  const result = Object.defineProperty(target, "x", holder);
  console.log((result.x = item) === item, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
