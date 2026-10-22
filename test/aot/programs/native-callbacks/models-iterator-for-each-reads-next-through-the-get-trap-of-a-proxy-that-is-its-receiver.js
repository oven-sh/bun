// Iterator.prototype.forEach reads next through the get trap of the proxy that is its receiver.
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
const values = [1.5, item, "two"];
const seen = [];
const inner = {
  index: 0,
  next() {
    return inner.index < values.length ? { done: false, value: values[inner.index++] } : { done: true, value: undefined };
  },
};
const steps = new Proxy(inner, {
  get(target, key, receiver) {
    log.push("get " + String(key) + " " + (receiver === steps));
    return target[key];
  },
});
try {
  const result = Iterator.prototype.forEach.call(steps, (value, index) => {
    seen.push(typeof value + index);
    if (typeof value === "object") seen.push(value.double());
  });
  console.log(result, seen.join());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
