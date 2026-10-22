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
const subject = new EventTarget();
const probe = {
  first: 1.5,
  second: "two",
  third: item,
  get [Symbol.toStringTag]() {
    calls++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const result = subject.removeEventListener(probe, null, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
