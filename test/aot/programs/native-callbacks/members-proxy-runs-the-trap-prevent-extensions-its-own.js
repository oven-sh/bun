// A proxy reads preventExtensions of its handler; here it is the object's own.
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
const holder = {
  preventExtensions(target) {
    log.push("preventExtensions " + (this === holder) + " " + arguments.length);
    return Reflect.preventExtensions(target);
  },
};
try {
  const result = Object.preventExtensions(new Proxy(target, holder));
  console.log(Object.isExtensible(target));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
