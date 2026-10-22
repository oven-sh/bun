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
  toJSON(key) {
    calls++;
    this.count++;
    console.log("toJSON", typeof key, this === probe);
    return { made: 1.5 };
  },
};
const holder = { first: probe, second: "two", third: item };
const result = JSON.stringify(holder, null, 3.5);
console.log(typeof result, result.length, result, typeof holder, Object.keys(holder).join());
console.log(typeof holder.first, Object.keys(holder.first).join(), typeof holder.first.count, holder.first.count + 1);
console.log(typeof holder.first.toJSON, holder.first.toJSON.length, typeof holder.second, holder.second.length, holder.second);
console.log(holder.third.double());
console.log(calls, probe.count);
