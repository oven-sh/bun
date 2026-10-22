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
const first = [1.5, item, "two"];
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
const result = Object.defineProperty(first, probe, third);
console.log(result === first, Array.isArray(first), first.length, typeof first[0], first[0] + 1);
console.log(first[1] === item, first[1].double(), typeof first[2], first[2].length, first[2]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
