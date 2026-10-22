// String.prototype.matchAll reads Symbol.matchAll of what it is given; here the object inherits it from a plain object.
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
    [Symbol.matchAll](text, more) {
      log.push("matchAll " + (this === holder) + " " + typeof text + " " + typeof more);
      return item;
    },
  },
};
try {
  const result = "text".matchAll(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
