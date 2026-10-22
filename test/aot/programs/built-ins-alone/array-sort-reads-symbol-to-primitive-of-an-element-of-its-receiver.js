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
const holder = [probe, item, "two"];
const result = holder.sort();
console.log(result === holder, Array.isArray(holder), holder.length, holder[0].double(), typeof holder[1]);
console.log(Object.keys(holder[1]).join(), typeof holder[1].count, holder[1].count + 1);
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
