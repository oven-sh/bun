// Object.fromEntries reads the members 0 and 1 of each entry; here an entry is an empty object that inherits both from a plain object.
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
const source = [{ __proto__: { 0: "a", 1: 1.5 } }, { __proto__: { 0: "b", 1: item } }, ["c", "two"]];
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
