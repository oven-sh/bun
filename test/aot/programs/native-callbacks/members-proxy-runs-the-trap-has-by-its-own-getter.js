// A proxy reads has of its handler; here the object has a getter under that name.
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
  get has() {
    log.push("get has " + (this === holder));
    return function (target, key) {
      log.push("has " + (this === holder) + " " + arguments.length);
      return key in target;
    };
  },
};
try {
  const result = "x" in new Proxy(target, holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
