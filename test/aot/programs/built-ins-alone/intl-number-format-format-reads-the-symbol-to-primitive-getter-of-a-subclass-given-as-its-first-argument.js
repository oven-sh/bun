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
const subject = new Intl.NumberFormat("en");
class Special extends Array {
  count = 0;
  get [Symbol.toPrimitive]() {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.format(special);
console.log(typeof result, Array.isArray(special), special.length, typeof special[0], special[1].double());
console.log(typeof special[2], typeof special.count);
console.log(calls, special.count);
