// Reflect.defineProperty reads value of what it is given; here the plain object above has a getter under that name.
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
const target = {};
const holder = {
  __proto__: {
    get value() {
      log.push("get value " + (this === holder));
      return item;
    },
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Reflect.defineProperty(target, "x", holder);
  console.log(result, target.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
