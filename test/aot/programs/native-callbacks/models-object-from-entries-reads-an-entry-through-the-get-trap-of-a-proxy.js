// Object.fromEntries reads the members 0 and 1 of each entry; here each entry is a proxy.
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
const values = [["a", 1.5], ["b", item], ["c", "two"]];
const source = values.map(entry => new Proxy(entry, {
  get(target, key) {
    log.push("get " + String(key) + " " + arguments.length);
    return target[key];
  },
}));
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
