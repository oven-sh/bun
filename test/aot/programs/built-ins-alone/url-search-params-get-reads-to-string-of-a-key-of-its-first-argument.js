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
const subject = new URLSearchParams("first=1&second=two&first=3");
const probe = {
  count: 0,
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [[probe, 1.5], ["second", item]];
const result = subject.get(holder);
console.log(result === null, Array.isArray(holder), holder.length, Array.isArray(holder[0]), holder[0].length);
console.log(typeof holder[0][0], typeof holder[0][1], holder[0][1] + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
