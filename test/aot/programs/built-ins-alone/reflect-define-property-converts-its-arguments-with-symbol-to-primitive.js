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
const first = { first: 1.5, second: "two", third: item };
const third = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "-";
  },
};
const result = Reflect.defineProperty(first, probe, third);
console.log(typeof result, result, typeof first, Object.keys(first).join());
console.log(typeof first.first, first.first + 1, typeof first.second, first.second.length, first.second);
console.log(first.third === item, first.third.double(), typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
