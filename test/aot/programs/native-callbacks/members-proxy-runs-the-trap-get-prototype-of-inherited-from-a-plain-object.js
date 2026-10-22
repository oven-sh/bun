// A proxy reads getPrototypeOf of its handler; here the object inherits it from a plain object.
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
    getPrototypeOf(target) {
      log.push("getPrototypeOf " + (this === holder) + " " + arguments.length);
      return Item.prototype;
    },
  },
};
try {
  const result = Object.getPrototypeOf(new Proxy(target, holder));
  console.log(result.double.call(item));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
