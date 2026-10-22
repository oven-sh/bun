// new WeakSet(..) runs the get trap of a proxy around the list. Nothing else in the program reaches that code.
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
const values = [keyA, item];
const source = new Proxy(values, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source) + " " + arguments.length);
    return Reflect.get(target, key, receiver);
  },
});
try {
  const result = new WeakSet(source);
  console.log(result.has(keyA), result.has(item), result.has(keyB));
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
