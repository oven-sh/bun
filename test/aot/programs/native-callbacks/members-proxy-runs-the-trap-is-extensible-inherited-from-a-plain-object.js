// A proxy reads isExtensible of its handler; here the object inherits it from a plain object.
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
  __proto__: {
    isExtensible(target) {
      log.push("isExtensible " + (this === holder) + " " + arguments.length);
      return Reflect.isExtensible(target);
    },
  },
};
try {
  const result = Object.isExtensible(new Proxy(target, holder));
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
