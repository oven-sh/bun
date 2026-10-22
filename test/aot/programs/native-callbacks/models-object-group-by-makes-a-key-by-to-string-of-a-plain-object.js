// Object.groupBy turns a plain object into a property key by its toString. Nothing else in the program reaches that code.
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
  tag: "key",
  toString(hint) {
    log.push("toString " + (this === key) + " " + typeof hint + " " + (this.tag + 1));
    return "b";
  },
};
try {
  const result = Object.groupBy([1.5, item], value => (typeof value === "object" ? key : "a"));
  console.log(Object.keys(result).join(), result.b[0].double(), result.a[0] + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
