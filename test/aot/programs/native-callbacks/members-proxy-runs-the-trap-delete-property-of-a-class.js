// A proxy reads deleteProperty of its handler; here the object is an instance of a class whose prototype object has it.
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
  deleteProperty(target, key) {
    log.push("deleteProperty " + (this === holder) + " " + arguments.length);
    return delete target[key];
  }
}
const holder = new Holder();
try {
  const result = delete new Proxy(target, holder).x;
  console.log(result, "x" in target);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
