// Object.defineProperties reads get of what it is given; here the object is an instance of a class whose prototype object has it.
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
  configurable = true;
  enumerable = true;
  get() {
    log.push("runs get " + arguments.length);
    return item;
  }
}
const holder = new Holder();
try {
  const result = Object.defineProperties({}, { x: holder });
  console.log(result.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
