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
  first: 1.5,
  second: "two",
  third: item,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive", hint, this === probe);
    return "first";
  },
};
const result = subject.append(probe, 2.5);
console.log(typeof result, result === undefined, subject instanceof URLSearchParams, Object.keys(subject).join());
const items = [...subject];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length, Array.isArray(items[2]), items[2].length);
console.log(Array.isArray(items[3]), items[3].length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
