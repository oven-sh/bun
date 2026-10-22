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
const result = Intl.Segmenter.supportedLocalesOf(probe, 2.5);
console.log(Array.isArray(result), result.length, typeof probe, Object.keys(probe).join(), typeof probe.count);
console.log(typeof probe.first, typeof probe.second, probe.third.double());
console.log(calls, probe.count);
