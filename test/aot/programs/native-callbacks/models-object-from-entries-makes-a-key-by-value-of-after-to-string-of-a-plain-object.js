// Object.fromEntries turns a plain object into a property key by its toString, which answers with an object, and then valueOf. Nothing else in the program reaches that code.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const log = [];
const key = {
  toString() {
    log.push("toString " + (this === key));
    return {};
  },
  valueOf() {
    log.push("valueOf " + (this === key));
    return "b";
  },
};
try {
  const result = Object.fromEntries([["a", 1.5], [key, item]]);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
