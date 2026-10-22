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
const subject = new URLSearchParams("first=1&second=two&first=3");
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
const result = subject.get(probe);
console.log(result === null, typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.first, probe.first + 1, typeof probe.second, probe.second.length, probe.second);
console.log(probe.third.double());
console.log(calls, probe.count);
