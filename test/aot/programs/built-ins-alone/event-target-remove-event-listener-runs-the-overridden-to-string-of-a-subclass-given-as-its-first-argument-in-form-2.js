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
class Special extends Array {
  toString(firstValue, secondValue) {
    calls++;
    console.log("toString", arguments.length, typeof firstValue, typeof secondValue);
    return super.toString(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.removeEventListener(special, null, 3.5);
console.log(typeof result, result === undefined);
console.log(calls);
