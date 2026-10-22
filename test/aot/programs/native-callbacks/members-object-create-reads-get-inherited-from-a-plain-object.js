// Object.create reads get of what it is given; here the object inherits it from a plain object.
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
const holder = {
  __proto__: {
    get() {
      log.push("runs get " + arguments.length);
      return item;
    },
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.create(null, { x: holder });
  console.log(result.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
