// Array.prototype.flat takes a proxy of an array for an array; here such a proxy stands inside.
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
const inner = new Proxy([item, "two"], {
  has(target, key) {
    log.push("has " + String(key));
    return key in target;
  },
  get(target, key) {
    log.push("get " + String(key));
    return target[key];
  },
});
const source = [1.5, inner];
try {
  const result = source.flat();
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
