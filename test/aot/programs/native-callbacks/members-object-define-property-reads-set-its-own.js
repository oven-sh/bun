// Object.defineProperty reads set of what it is given; here it is the object's own.
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
const holder = {
  set(value) {
    log.push("runs set " + (this === target) + " " + typeof value);
    kept.push(value);
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.defineProperty(target, "x", holder);
  console.log((result.x = item) === item, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
