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
class Special extends Array {
  count = 0;
  valueOf(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("valueOf", arguments.length, typeof firstValue, typeof secondValue);
    return super.valueOf(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.setResourceTimingBufferSize(special);
console.log(typeof result, result === undefined, Array.isArray(special), special.length, typeof special[0]);
console.log(special[1].double(), typeof special[2], typeof special.count);
console.log(calls, special.count);
