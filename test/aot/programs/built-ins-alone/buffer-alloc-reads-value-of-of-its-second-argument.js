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
  first: 1.5,
  second: "two",
  third: item,
  valueOf() {
    calls++;
    this.count++;
    console.log("valueOf", this === probe);
    return "first";
  },
};
const result = Buffer.alloc(1.5, probe, 3.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.first, probe.first + 1, typeof probe.second, probe.second.length, probe.second);
console.log(probe.third.double());
console.log(calls, probe.count);
