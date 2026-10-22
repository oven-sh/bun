// A proxy reads setPrototypeOf of its handler; here the plain object above has a getter under that name.
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
    get setPrototypeOf() {
      log.push("get setPrototypeOf " + (this === holder));
      return function (target, prototype) {
        log.push("setPrototypeOf " + (this === holder) + " " + arguments.length);
        return Reflect.setPrototypeOf(target, prototype);
      };
    },
  },
};
try {
  const result = Object.setPrototypeOf(new Proxy(target, holder), Item.prototype);
  console.log(target.double.call(item));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
