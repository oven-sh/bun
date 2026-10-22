// Object.entries reads each property of a proxy.
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
const source = new Proxy({ a: 1.5, b: item }, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source));
    return target[key];
  },
});
try {
  const result = Object.entries(source);
  console.log(result.map(entry => entry[0] + typeof entry[1]).join(), result.find(entry => typeof entry[1] === "object")[1].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
