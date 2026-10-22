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
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const result = subject.clearMeasures(probe);
console.log(typeof result, result === undefined, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.first, typeof probe.second, probe.third.double());
console.log(calls, probe.count);
