// Array.prototype.includes reads index 1 of what it is given; here it is a plain object, and the plain object two above it has a getter and a setter there.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
  toString() {
    log.push("toString " + (this === item));
    return "item " + this.size;
  }
}
const log = [];
const seen = [];
const item = new Item(1.5);
const like = {
  __proto__: {
    __proto__: {
      get 1() {
        log.push("get 1 " + (this === like));
        return item;
      },
      set 1(value) {
        log.push("set 1 " + (this === like) + " " + typeof value);
      },
    },
  },
  0: 1.5,
  2: "two",
  length: 3,
};
try {
  const result = Array.prototype.includes.call(like, item);
  console.log(result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
