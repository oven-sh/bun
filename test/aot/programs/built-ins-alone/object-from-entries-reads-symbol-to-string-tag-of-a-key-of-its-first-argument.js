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
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [[probe, 1.5], ["second", item]];
const result = Object.fromEntries(holder);
console.log(typeof result, Object.keys(result).join(), typeof result["[object Object]"], result["[object Object]"] + 1, result.second.double());
console.log(Array.isArray(holder), holder.length, Array.isArray(holder[0]), holder[0].length, typeof holder[0][0]);
console.log(typeof holder[0][1], holder[0][1] + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
