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
const subject = new Intl.NumberFormat("en");
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  valueOf() {
    calls++;
    this.count++;
    console.log("valueOf", this === probe);
    return "first";
  },
};
const result = subject.format(probe);
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count, typeof probe.first);
console.log(typeof probe.second, probe.third.double());
console.log(calls, probe.count);
