// Array.from with a function reads index 1 of what it is given; here it is a plain object, and the element stands two plain objects above it.
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
  __proto__: { __proto__: { 1: item } },
  0: 1.5,
  2: "two",
  length: 3,
};
try {
  const result = Array.from(like, value => {
    seen.push(typeof value === "object" ? value.double() : typeof value);
    return true;
  });
  console.log(result.join(), seen.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
