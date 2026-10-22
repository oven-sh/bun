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
  get 0() {
    calls++;
    this.count++;
    console.log("0", this === probe);
    return undefined;
  },
};
const holder = [probe, ["second", item]];
const result = new Map(holder);
console.log(result instanceof Map, result.size, result.get("second").double(), Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0][0], holder[0][0] === undefined);
console.log(typeof holder[0].count, holder[0].count + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
