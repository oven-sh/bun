// Object.prototype.toString reads Symbol.toStringTag of what it is given; here the object has a getter under that name.
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
  get [Symbol.toStringTag]() {
    log.push("get Symbol.toStringTag " + (this === holder));
    return "Tag" + item.double();
  },
};
try {
  const result = Object.prototype.toString.call(holder);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
