// Array.prototype.flat asks for each index and reads it; here the receiver is a proxy of an array.
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
const source = new Proxy([1.5, [item, "two"]], {
  has(target, key) {
    log.push("has " + String(key));
    return key in target;
  },
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source));
    return target[key];
  },
});
try {
  const result = Array.prototype.flat.call(source);
  console.log(result.length, result.map(value => typeof value).join(), result.find(value => typeof value === "object").double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
