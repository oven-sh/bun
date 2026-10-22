// Object.fromEntries runs the get trap of a proxy around the list. Nothing else in the program reaches that code.
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
const source = new Proxy(values, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === source) + " " + arguments.length);
    return Reflect.get(target, key, receiver);
  },
});
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
