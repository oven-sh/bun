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
const subject = performance;
const second = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
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
const result = subject.mark(probe, second);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.first, typeof probe.second, probe.third.double());
console.log(calls, probe.count);
