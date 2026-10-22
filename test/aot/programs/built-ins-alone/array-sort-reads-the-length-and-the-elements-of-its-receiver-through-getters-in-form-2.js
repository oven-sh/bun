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
  work: Array.prototype.sort,
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
try {
  probe.work();
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
