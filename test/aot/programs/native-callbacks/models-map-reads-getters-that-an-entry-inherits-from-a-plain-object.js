// new Map(..) reads the members 0 and 1 of each entry; here an entry inherits two getters from a plain object.
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
const source = [{ __proto__: above, name: "a", held: 1.5 }, { __proto__: above, name: "b", held: item }, [item, "two"]];
try {
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
