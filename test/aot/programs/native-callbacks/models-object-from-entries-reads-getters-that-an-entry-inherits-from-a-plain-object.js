// Object.fromEntries reads the members 0 and 1 of each entry; here an entry inherits two getters from a plain object.
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
const above = {
  get 0() {
    log.push("get 0 " + typeof this.held);
    return this.name;
  },
  get 1() {
    log.push("get 1 " + typeof this.held);
    return this.held;
  },
};
const source = [{ __proto__: above, name: "a", held: 1.5 }, { __proto__: above, name: "b", held: item }, ["c", "two"]];
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
