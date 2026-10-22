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
const holder = [probe, item, "two"];
const result = holder.toSorted();
console.log(Array.isArray(result), result.length, result[0].double(), typeof result[1], Object.keys(result[1]).join());
console.log(typeof result[1].count, result[1].count + 1, typeof result[1].toString, result[1].toString.length);
console.log(typeof result[2], result[2].length, result[2], Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1);
console.log(typeof holder[0].toString, holder[0].toString.length, holder[1].double());
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
