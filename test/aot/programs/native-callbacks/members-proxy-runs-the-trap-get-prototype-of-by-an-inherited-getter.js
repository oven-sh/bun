// A proxy reads getPrototypeOf of its handler; here the plain object above has a getter under that name.
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
    get getPrototypeOf() {
      log.push("get getPrototypeOf " + (this === holder));
      return function (target) {
        log.push("getPrototypeOf " + (this === holder) + " " + arguments.length);
        return Item.prototype;
      };
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
