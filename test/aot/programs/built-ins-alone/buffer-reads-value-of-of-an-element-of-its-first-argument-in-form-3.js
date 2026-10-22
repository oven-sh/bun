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
  valueOf() {
    calls++;
    this.count++;
    console.log("valueOf", this === probe);
    return "first";
  },
};
const holder = [probe, item, "two"];
const result = new Buffer(holder, 2.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1], Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1);
console.log(typeof holder[0].valueOf, holder[0].valueOf.length, holder[1].double());
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
