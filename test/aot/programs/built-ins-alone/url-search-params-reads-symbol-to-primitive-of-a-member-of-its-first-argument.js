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
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive", hint, this === probe);
    return "first";
  },
};
const holder = { first: probe, second: "two", third: item };
const result = new URLSearchParams(holder);
console.log(result instanceof URLSearchParams, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length, typeof holder);
console.log(Object.keys(holder).join(), typeof holder.first, Object.keys(holder.first).join(), typeof holder.first.count, holder.first.count + 1);
console.log(typeof holder.second, holder.second.length, holder.second, holder.third.double());
console.log(calls, probe.count);
