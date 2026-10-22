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
  work: Array.prototype.toLocaleString,
  get length() {
    calls++;
    this.count++;
    console.log("length");
    return 3;
  },
  get 0() {
    calls++;
    this.count++;
    console.log("element 0");
    return 1.5;
  },
  get 1() {
    calls++;
    this.count++;
    console.log("element 1");
    return item;
  },
  get 2() {
    calls++;
    this.count++;
    console.log("element 2");
    return "two";
  },
};
const result = probe.work(1.5, 2.5);
console.log(typeof result, typeof probe, Object.keys(probe).join(), typeof probe[0], probe[1].double());
console.log(typeof probe[2], typeof probe.count);
console.log(calls, probe.count);
