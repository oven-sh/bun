// Object.defineProperty reads set of what it is given; here the object has a getter under that name.
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
const target = {};
const holder = {
  get set() {
    log.push("get set " + (this === holder));
    return function (value) {
      log.push("runs set " + (this === target) + " " + typeof value);
      kept.push(value);
    };
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.defineProperty(target, "x", holder);
  console.log((result.x = item) === item, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
