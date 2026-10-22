// A proxy reads get of its handler; here the plain object above has a getter under that name.
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
    get get() {
      log.push("get get " + (this === holder));
      return function (target, key, receiver) {
        log.push("get " + (this === holder) + " " + arguments.length);
        return target[key];
      };
    },
  },
};
try {
  const result = new Proxy(target, holder).x;
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
