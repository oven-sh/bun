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
  toLocaleString(...passed) {
    calls++;
    this.count++;
    console.log("called toLocaleString", passed.length, passed.map(each => typeof each).join(), this === probe);
    return undefined;
  },
};
const holder = [probe, item, "two"];
const result = holder.toLocaleString(1.5, 2.5);
console.log(typeof result, Array.isArray(holder), holder.length, typeof holder[0], Object.keys(holder[0]).join());
console.log(typeof holder[0].count, typeof holder[0].toLocaleString, holder[0].toLocaleString.length, holder[1].double(), typeof holder[2]);
console.log(calls, probe.count);
