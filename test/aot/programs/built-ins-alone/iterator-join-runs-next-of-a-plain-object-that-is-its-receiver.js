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
  count: 0,
  work: Iterator.prototype.join,
  index: 0,
  items: [1.5, item, "two"],
  next() {
    calls++;
    this.count++;
    console.log("next", this === probe, arguments.length);
    return this.index < this.items.length ? { done: false, value: this.items[this.index++] } : { done: true, value: undefined };
  },
  return() {
    calls++;
    this.count++;
    console.log("return", this === probe);
    return {};
  },
};
const result = probe.work(1.5);
console.log(typeof result, result.length, result, typeof probe);
const step = probe.next();
console.log(step.done, typeof step.value, step.value === undefined);
console.log(calls, probe.count);
