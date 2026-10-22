// Array.from reads length of what it is given; here the plain object above has a getter under that name.
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
    get length() {
      log.push("get length " + (this === holder));
      return 2;
    },
  },
  0: 1.5,
  1: item,
};
try {
  const result = Array.from(holder);
  console.log(result.length, result[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
