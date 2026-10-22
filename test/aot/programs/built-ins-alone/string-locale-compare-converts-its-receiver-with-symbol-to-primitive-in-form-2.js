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
const second = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  work: String.prototype.localeCompare,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "banana";
  },
};
const result = probe.work("an", second, 3.5);
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(calls, probe.count);
