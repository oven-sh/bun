// Reflect.construct(Set, .., a proxy of a subclass) reads the prototype property through the get trap of the proxy.
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
class Held extends Set {
  add(value) {
    log.push("add " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return super.add(value);
  }
}
const target = new Proxy(Held, {
  get(held, key) {
    log.push("get " + String(key) + " " + arguments.length);
    return held[key];
  },
});
try {
  const result = Reflect.construct(Set, [[1.5, item]], target);
  console.log(result.size, [...result][1].double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
