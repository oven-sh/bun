let calls = 0;
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const probe = {
  work: Iterator.prototype.drop,
  index: 0,
  items: [1.5, item, "two"],
  next() {
    calls++;
    console.log("next", this === probe, arguments.length);
    return this.index < this.items.length ? { done: false, value: this.items[this.index++] } : { done: true, value: undefined };
  },
  return() {
    calls++;
    console.log("return", this === probe);
    return {};
  },
};
const result = probe.work(1.5);
console.log(typeof result);
const step = result.next();
console.log(step.done, step.value.double(), [...result].length, typeof probe);
const step2 = probe.next();
console.log(step2.done, typeof step2.value, step2.value === undefined);
console.log(calls);
