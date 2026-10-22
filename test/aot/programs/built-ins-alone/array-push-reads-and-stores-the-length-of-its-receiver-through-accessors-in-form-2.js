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
  work: Array.prototype.push,
  get length() {
    calls++;
    this.count++;
    console.log("length");
    return 3;
  },
  set length(value) {
    calls++;
    this.count++;
    console.log("store to length", typeof value, value);
  },
  0: 1.5,
  1: item,
  2: "two",
};
const result = probe.work("an", "an");
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe[0], probe[0] + 1, probe[1].double());
console.log(typeof probe[2], probe[2].length, probe[2]);
console.log(typeof probe[3], probe[3].length, probe[3]);
console.log(calls, probe.count);
