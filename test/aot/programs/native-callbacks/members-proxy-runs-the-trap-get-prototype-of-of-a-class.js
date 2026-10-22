// A proxy reads getPrototypeOf of its handler; here the object is an instance of a class whose prototype object has it.
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
const target = { x: item };
class Holder {
  getPrototypeOf(target) {
    log.push("getPrototypeOf " + (this === holder) + " " + arguments.length);
    return Item.prototype;
  }
}
const holder = new Holder();
try {
  const result = Object.getPrototypeOf(new Proxy(target, holder));
  console.log(result.double.call(item));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
