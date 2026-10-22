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
const subject = new URLSearchParams("first=1&second=two&first=3");
class Special extends Array {
  count = 0;
  toString(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("toString", arguments.length, typeof firstValue, typeof secondValue);
    return super.toString(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.get(special);
console.log(result === null, Array.isArray(special), special.length, typeof special[0], special[0] + 1);
console.log(special[1].double(), typeof special[2], special[2].length, special[2]);
console.log(typeof special.count, special.count + 1);
console.log(calls, special.count);
