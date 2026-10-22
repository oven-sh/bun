// Object.fromEntries reads the members 0 and 1 of each entry; here the entries are instances of a class that has two getters under those names.
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
class Pair {
  constructor(name, held) {
    this.name = name;
    this.held = held;
  }
  get 0() {
    log.push("get 0 " + typeof this.held);
    return this.name;
  }
  get 1() {
    log.push("get 1 " + typeof this.held);
    return this.held;
  }
}
const source = [new Pair("a", 1.5), new Pair("b", item), ["c", "two"]];
try {
  const result = Object.fromEntries(source);
  console.log(Object.keys(result).join(), result.b.double(), result.a + 1, result.c + 1);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
