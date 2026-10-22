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
const holder = [probe, ["second", item]];
const result = new Uint32Array(holder);
console.log(result instanceof Uint32Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1], Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1);
console.log(typeof holder[0].valueOf, holder[0].valueOf.length, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
