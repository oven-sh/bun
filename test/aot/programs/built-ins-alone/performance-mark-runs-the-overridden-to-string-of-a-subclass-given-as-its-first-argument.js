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
const subject = performance;
const second = { first: 1.5, second: "two", third: item };
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
const result = subject.mark(special, second);
console.log(typeof result, Object.keys(result).join(), Array.isArray(special), special.length, typeof special[0]);
console.log(special[1].double(), typeof special[2], typeof special.count);
console.log(calls, special.count);
