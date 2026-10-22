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
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [[probe, 1.5], ["second", item]];
const result = Bun.JSONL.parseChunk(holder, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, typeof result.done, result.done, result.error === null);
console.log(Array.isArray(holder), holder.length, Array.isArray(holder[0]), holder[0].length, typeof holder[0][0]);
console.log(typeof holder[0][1], holder[0][1] + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
