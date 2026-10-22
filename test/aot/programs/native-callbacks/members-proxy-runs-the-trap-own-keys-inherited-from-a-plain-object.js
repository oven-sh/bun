// A proxy reads ownKeys of its handler; here the object inherits it from a plain object.
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
    ownKeys(target) {
      log.push("ownKeys " + (this === holder) + " " + arguments.length);
      return Reflect.ownKeys(target);
    },
  },
};
try {
  const result = Object.keys(new Proxy(target, holder));
  console.log(result.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
