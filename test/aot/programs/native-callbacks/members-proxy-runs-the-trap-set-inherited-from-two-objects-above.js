// A proxy reads set of its handler; here the object inherits it from the plain object two above.
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
    __proto__: {
      set(target, key, value) {
        log.push("set " + (this === holder) + " " + arguments.length);
        return Reflect.set(target, key, value);
      },
    },
  },
};
try {
  const result = (new Proxy(target, holder).y = item);
  console.log(target.y.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
