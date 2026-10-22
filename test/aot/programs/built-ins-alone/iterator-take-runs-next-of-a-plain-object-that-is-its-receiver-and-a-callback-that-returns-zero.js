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
  work: Iterator.prototype.take,
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
console.log(step.done, typeof step.value, step.value + 1, [...result].length, typeof probe);
const step2 = probe.next();
console.log(step2.done, step2.value.double());
console.log(calls);
