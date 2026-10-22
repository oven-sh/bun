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
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  get startTime() {
    calls++;
    this.count++;
    console.log("startTime", this === probe);
    return undefined;
  },
};
const result = subject.mark(1.5, probe);
console.log(typeof result, Object.keys(result).join(), typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.first, typeof probe.second, probe.third.double());
console.log(calls, probe.count);
