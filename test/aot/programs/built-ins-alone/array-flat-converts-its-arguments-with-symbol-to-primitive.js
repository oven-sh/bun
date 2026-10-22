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
const list = [1.5, item, "two"];
const probe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1;
  },
};
const result = list.flat(probe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(result[1] === item, result[1].double(), typeof result[2], result[2].length, result[2]);
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
