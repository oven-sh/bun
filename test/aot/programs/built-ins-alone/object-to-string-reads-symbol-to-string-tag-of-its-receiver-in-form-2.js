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
  work: Object.prototype.toString,
  first: 1.5,
  second: "two",
  third: item,
  get [Symbol.toStringTag]() {
    calls++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const result = probe.work();
console.log(typeof result, result.length, result);
console.log(calls);
