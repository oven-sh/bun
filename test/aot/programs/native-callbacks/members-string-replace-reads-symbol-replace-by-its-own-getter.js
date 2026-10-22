// String.prototype.replace reads Symbol.replace of what it is given; here the object has a getter under that name.
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
  get [Symbol.replace]() {
    log.push("get Symbol.replace " + (this === holder));
    return function (text, more) {
      log.push("replace " + (this === holder) + " " + typeof text + " " + typeof more);
      return item;
    };
  },
};
try {
  const result = "text".replace(holder, "x");
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
