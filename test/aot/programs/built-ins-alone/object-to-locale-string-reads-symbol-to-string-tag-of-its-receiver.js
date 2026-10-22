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
  work: Object.prototype.toLocaleString,
  first: 1.5,
  second: "two",
  third: item,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const result = probe.work();
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.work, probe.work.length, typeof probe.first, typeof probe.second);
console.log(calls, probe.count);
