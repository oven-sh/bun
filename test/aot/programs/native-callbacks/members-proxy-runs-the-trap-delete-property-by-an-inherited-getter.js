// A proxy reads deleteProperty of its handler; here the plain object above has a getter under that name.
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
    get deleteProperty() {
      log.push("get deleteProperty " + (this === holder));
      return function (target, key) {
        log.push("deleteProperty " + (this === holder) + " " + arguments.length);
        return delete target[key];
      };
    },
  },
};
try {
  const result = delete new Proxy(target, holder).x;
  console.log(result, "x" in target);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
