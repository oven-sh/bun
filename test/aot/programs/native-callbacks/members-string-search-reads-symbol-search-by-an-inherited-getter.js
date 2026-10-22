// String.prototype.search reads Symbol.search of what it is given; here the plain object above has a getter under that name.
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
    get [Symbol.search]() {
      log.push("get Symbol.search " + (this === holder));
      return function (text, more) {
        log.push("search " + (this === holder) + " " + typeof text + " " + typeof more);
        return item;
      };
    },
  },
};
try {
  const result = "text".search(holder);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
