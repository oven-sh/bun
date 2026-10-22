// String.raw reads raw of what it is given; here the plain object above has a getter under that name.
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
    get raw() {
      log.push("get raw " + (this === holder));
      return ["a", "b" + item.double()];
    },
  },
};
try {
  const result = String.raw(holder, 1);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
