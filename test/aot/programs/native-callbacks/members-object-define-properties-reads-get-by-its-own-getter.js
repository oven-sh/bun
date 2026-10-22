// Object.defineProperties reads get of what it is given; here the object has a getter under that name.
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
  get get() {
    log.push("get get " + (this === holder));
    return function () {
      log.push("runs get " + arguments.length);
      return item;
    };
  },
  configurable: true,
  enumerable: true,
};
try {
  const result = Object.defineProperties({}, { x: holder });
  console.log(result.x.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
