// Object.prototype.toLocaleString reads toString through the get trap of a proxy.
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
const source = new Proxy({}, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source));
    return () => "text " + item.double();
  },
});
try {
  const result = Object.prototype.toLocaleString.call(source);
  console.log(typeof result, result);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
