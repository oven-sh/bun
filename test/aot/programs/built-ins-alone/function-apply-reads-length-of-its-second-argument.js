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
const subject = function work(first, second) {
  return second;
};
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  get length() {
    calls++;
    this.count++;
    console.log("length", this === probe);
    return undefined;
  },
};
const result = subject.apply(1.5, probe);
console.log(typeof result, result === undefined, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
