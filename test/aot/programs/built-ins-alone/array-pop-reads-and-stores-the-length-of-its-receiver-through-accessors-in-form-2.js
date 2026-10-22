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
  work: Array.prototype.pop,
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
const result = probe.work();
console.log(typeof result, result.length, result, typeof probe, Object.keys(probe).join());
console.log(typeof probe[0], probe[0] + 1, probe[1].double(), typeof probe.work, probe.work.length);
console.log(typeof probe.length, probe.length + 1);
console.log(calls);
