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
  toString() {
    calls++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [["first", probe], ["second", item]];
const result = subject.removeEventListener(holder, null, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
