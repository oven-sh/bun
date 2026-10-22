// A proxy reads get of its handler; here the object is an instance of a class whose prototype object has it.
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
  get(target, key, receiver) {
    log.push("get " + (this === holder) + " " + arguments.length);
    return target[key];
  }
}
const holder = new Holder();
try {
  const result = new Proxy(target, holder).x;
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
