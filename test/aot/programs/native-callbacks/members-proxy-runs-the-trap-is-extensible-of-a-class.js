// A proxy reads isExtensible of its handler; here the object is an instance of a class whose prototype object has it.
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
  isExtensible(target) {
    log.push("isExtensible " + (this === holder) + " " + arguments.length);
    return Reflect.isExtensible(target);
  }
}
const holder = new Holder();
try {
  const result = Object.isExtensible(new Proxy(target, holder));
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
