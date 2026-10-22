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
const holder = [probe, item, "two"];
const result = subject.append(holder, 2.5);
console.log(typeof result, result === undefined, subject instanceof URLSearchParams, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length);
console.log(Array.isArray(items[3]), items[3].length, Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, typeof holder[0].toString, holder[0].toString.length);
console.log(holder[1].double(), typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
