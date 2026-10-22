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
const probe = {
  count: 0,
  work: Array.prototype.indexOf,
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
const result = probe.work(first, 2);
console.log(typeof result, result + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe[0], probe[0] + 1, probe[1].double());
console.log(typeof probe[2], probe[2].length, probe[2], typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
