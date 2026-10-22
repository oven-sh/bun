// A proxy reads ownKeys of its handler; here the object is an instance of a class whose prototype object has it.
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
  ownKeys(target) {
    log.push("ownKeys " + (this === holder) + " " + arguments.length);
    return Reflect.ownKeys(target);
  }
}
const holder = new Holder();
try {
  const result = Object.keys(new Proxy(target, holder));
  console.log(result.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
