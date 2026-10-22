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
  valueOf() {
    calls++;
    console.log("probe valueOf", this === probe);
    return 2;
  },
  toString() {
    calls++;
    console.log("probe toString", this === probe);
    return "2";
  },
};
const result = list.indexOf(1.5, probe);
console.log(typeof result, result + 1);
console.log(calls);
