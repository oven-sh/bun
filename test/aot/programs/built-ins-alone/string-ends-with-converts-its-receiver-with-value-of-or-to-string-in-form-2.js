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
const first = [1.5, item, "two"];
const probe = {
  count: 0,
  work: String.prototype.endsWith,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "banana";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "banana";
  },
};
const result = probe.work(first, 2.5);
console.log(typeof result, result, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.work, probe.work.length);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
