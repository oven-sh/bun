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
  work: Array.prototype.unshift,
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
const result = probe.work("an", "an");
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe[0], probe[0].length, probe[0]);
console.log(typeof probe[1], probe[1].length, probe[1], typeof probe[2], probe[2] + 1);
console.log(probe[3].double());
console.log(calls);
