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
const subject = new Intl.NumberFormat("en");
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
const result = subject.format(holder);
console.log(typeof result, Array.isArray(holder), holder.length, typeof holder[0], Object.keys(holder[0]).join());
console.log(typeof holder[0].count, typeof holder[0].toString, holder[0].toString.length, holder[1].double(), typeof holder[2]);
console.log(calls, probe.count);
