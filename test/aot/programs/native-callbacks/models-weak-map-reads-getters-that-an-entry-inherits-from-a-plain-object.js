// new WeakMap(..) reads the members 0 and 1 of each entry; here an entry inherits two getters from a plain object.
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
const keyA = { name: "a" };
const keyB = { name: "b" };
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
const source = [{ __proto__: above, name: keyA, held: 1.5 }, { __proto__: above, name: keyB, held: item }];
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
