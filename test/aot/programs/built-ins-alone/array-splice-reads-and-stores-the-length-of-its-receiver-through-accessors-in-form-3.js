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
  work: Array.prototype.splice,
  get length() {
    calls++;
    console.log("length");
    return 3;
  },
  set length(value) {
    calls++;
    console.log("store to length", typeof value, value);
  },
  0: 1.5,
  1: item,
  2: "two",
};
const result = probe.work(1, 2, 3.5, "x");
console.log(Array.isArray(result), result.length, result[0].double());
console.log(typeof result[1], result[1].length, result[1], typeof probe, Object.keys(probe).join());
console.log(typeof probe[0], probe[0] + 1, typeof probe[1], probe[1] + 1);
console.log(typeof probe[2], probe[2].length, probe[2], typeof probe.work, probe.work.length);
console.log(calls);
