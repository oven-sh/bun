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
const result = Object.fromEntries(holder);
console.log(typeof result, Object.keys(result).join(), typeof result.undefined, result.undefined === undefined, result.second.double());
console.log(Array.isArray(holder), holder.length, typeof holder[0], Object.keys(holder[0]).join());
console.log(typeof holder[0][0], holder[0][0] === undefined, typeof holder[0].count, holder[0].count + 1);
console.log(Array.isArray(holder[1]), holder[1].length, typeof holder[1][0], holder[1][0].length, holder[1][0]);
console.log(holder[1][1].double());
console.log(calls, probe.count);
