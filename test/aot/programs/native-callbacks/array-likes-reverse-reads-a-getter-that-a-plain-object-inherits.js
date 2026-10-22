// Array.prototype.reverse reads index 1 of what it is given; here it is a plain object, and the plain object above it has a getter and a setter there. ECMAScript has it ask for index 1 up the chain, run the getter, and store through the setter; plain Bun runs neither and takes the index for absent, so the output is stored.
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
    get 1() {
      log.push("get 1 " + (this === like));
      return item;
    },
    set 1(value) {
      log.push("set 1 " + (this === like) + " " + typeof value);
    },
  },
  0: 1.5,
  length: 2,
};
try {
  const result = Array.prototype.reverse.call(like);
  console.log(result === like, typeof like[0] === "object" ? like[0].double() : typeof like[0], typeof like[1]);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
