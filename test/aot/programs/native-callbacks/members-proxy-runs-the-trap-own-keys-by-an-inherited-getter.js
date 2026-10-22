// A proxy reads ownKeys of its handler; here the plain object above has a getter under that name.
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
    get ownKeys() {
      log.push("get ownKeys " + (this === holder));
      return function (target) {
        log.push("ownKeys " + (this === holder) + " " + arguments.length);
        return Reflect.ownKeys(target);
      };
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
