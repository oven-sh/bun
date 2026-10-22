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
  join(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("join", arguments.length, typeof firstValue, typeof secondValue);
    return super.join(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.getAll(special);
console.log(Array.isArray(result), result.length, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
