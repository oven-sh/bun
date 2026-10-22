// new Map(..) reads the members 0 and 1 of each entry; here each entry is a proxy.
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
const values = [["a", 1.5], ["b", item], [item, "two"]];
const source = values.map(entry => new Proxy(entry, {
  get(target, key) {
    log.push("get " + String(key) + " " + arguments.length);
    return target[key];
  },
}));
try {
  const result = new Map(source);
  console.log(result.size, [...result.keys()].map(key => typeof key).join(), result.get("b").double(), result.get("a") + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
