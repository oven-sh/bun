// Object.defineProperty reads value of what it is given; here the object has a getter under that name.
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
  get value() {
    log.push("get value " + (this === holder));
    return item;
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.defineProperty({}, "x", holder);
  console.log(result.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
