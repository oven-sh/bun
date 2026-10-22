// A proxy reads preventExtensions of its handler; here the object is an instance of a class whose prototype object has it.
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
  preventExtensions(target) {
    log.push("preventExtensions " + (this === holder) + " " + arguments.length);
    return Reflect.preventExtensions(target);
  }
}
const holder = new Holder();
try {
  const result = Object.preventExtensions(new Proxy(target, holder));
  console.log(Object.isExtensible(target));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
