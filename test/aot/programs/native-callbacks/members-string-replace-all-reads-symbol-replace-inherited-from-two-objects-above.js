// String.prototype.replaceAll reads Symbol.replace of what it is given; here the object inherits it from the plain object two above.
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
    __proto__: {
      [Symbol.replace](text, more) {
        log.push("replace " + (this === holder) + " " + typeof text + " " + typeof more);
        return item;
      },
    },
  },
};
try {
  const result = "text".replaceAll(holder, "x");
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
