// new WeakMap(..) reads the members 0 and 1 of each entry; here each entry is a proxy.
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
const values = [[keyA, 1.5], [keyB, item]];
const source = values.map(entry => new Proxy(entry, {
  get(target, key) {
    log.push("get " + String(key) + " " + arguments.length);
    return target[key];
  },
}));
try {
  const result = new WeakMap(source);
  console.log(result.has(keyA), result.get(keyB).double(), result.get(keyA) + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
