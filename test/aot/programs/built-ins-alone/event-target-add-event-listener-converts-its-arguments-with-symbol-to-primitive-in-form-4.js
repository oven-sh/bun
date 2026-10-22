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
const second = { first: 1.5, second: "two", third: item };
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
const result = subject.addEventListener(probe, second, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
