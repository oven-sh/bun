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
  get first() {
    calls++;
    this.count++;
    console.log("getter first", this === probe);
    return 1.5;
  },
  get second() {
    calls++;
    this.count++;
    console.log("getter second", this === probe);
    return "two";
  },
  get third() {
    calls++;
    this.count++;
    console.log("getter third", this === probe);
    return item;
  },
};
const result = new URLSearchParams(probe);
console.log(result instanceof URLSearchParams, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length);
console.log(Array.isArray(items[3]), items[3].length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
