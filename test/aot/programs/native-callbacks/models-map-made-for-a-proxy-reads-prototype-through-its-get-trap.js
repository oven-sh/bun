// Reflect.construct(Map, .., a proxy of a subclass) reads the prototype property through the get trap of the proxy.
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
class Held extends Map {
  set(key, value) {
    log.push("set " + typeof key + " " + typeof value + " " + arguments.length + " " + (this instanceof Held));
    return super.set(key, value);
  }
}
const target = new Proxy(Held, {
  get(held, key) {
    log.push("get " + String(key) + " " + arguments.length);
    return held[key];
  },
});
try {
  const result = Reflect.construct(Map, [[["a", 1.5], ["b", item]]], target);
  console.log(result.size, result.get("b").double(), result instanceof Held);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
