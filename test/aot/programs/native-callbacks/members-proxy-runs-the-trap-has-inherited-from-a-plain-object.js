// A proxy reads has of its handler; here the object inherits it from a plain object.
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
    has(target, key) {
      log.push("has " + (this === holder) + " " + arguments.length);
      return key in target;
    },
  },
};
try {
  const result = "x" in new Proxy(target, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
