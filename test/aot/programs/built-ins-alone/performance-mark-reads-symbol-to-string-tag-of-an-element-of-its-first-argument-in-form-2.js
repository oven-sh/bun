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
const subject = performance;
const second = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [probe, ["second", item]];
const result = subject.mark(holder, second);
console.log(typeof result, Object.keys(result).join(), Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, Array.isArray(holder[1]), holder[1].length, typeof holder[1][0]);
console.log(holder[1][1].double());
console.log(calls, probe.count);
