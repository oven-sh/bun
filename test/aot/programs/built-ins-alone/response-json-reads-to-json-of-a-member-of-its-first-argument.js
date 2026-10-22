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
const result = Response.json(holder, null);
console.log(result instanceof Response, Object.keys(result).join(), typeof holder, Object.keys(holder).join(), typeof holder.first);
console.log(Object.keys(holder.first).join(), typeof holder.first.count, holder.first.count + 1, typeof holder.first.toJSON, holder.first.toJSON.length);
console.log(typeof holder.second, holder.second.length, holder.second, holder.third.double());
console.log(calls, probe.count);
