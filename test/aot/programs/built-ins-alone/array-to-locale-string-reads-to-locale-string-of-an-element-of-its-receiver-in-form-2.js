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
  get toLocaleString() {
    calls++;
    this.count++;
    console.log("toLocaleString", this === probe);
    return undefined;
  },
};
const holder = [probe, item, "two"];
try {
  holder.toLocaleString("an", 2.5);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
