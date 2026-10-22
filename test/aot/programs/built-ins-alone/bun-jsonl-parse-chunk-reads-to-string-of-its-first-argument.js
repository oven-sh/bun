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
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const result = Bun.JSONL.parseChunk(probe, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, typeof result.done, result.done, result.error === null);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.first, probe.first + 1, typeof probe.second, probe.second.length, probe.second);
console.log(probe.third.double());
console.log(calls, probe.count);
