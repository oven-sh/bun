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
  work: Array.prototype.shift,
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
const result = probe.work();
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join(), probe[0].double());
console.log(typeof probe[1], probe[1].length, probe[1], typeof probe.count, probe.count + 1);
console.log(typeof probe.work, probe.work.length);
console.log(calls, probe.count);
