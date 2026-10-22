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
const result = (1.5).toLocaleString(probe, 2.5);
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe.count, typeof probe.first);
console.log(typeof probe.second, probe.third.double());
console.log(calls, probe.count);
