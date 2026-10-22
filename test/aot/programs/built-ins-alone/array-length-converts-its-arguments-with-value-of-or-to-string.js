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
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return 1;
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "1";
  },
};
list.length = probe;
console.log(typeof list.length, list.length + 1);
console.log(calls, probe.count);
