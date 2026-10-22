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
class Special extends Array {
  join(firstValue, secondValue) {
    calls++;
    console.log("join", arguments.length, typeof firstValue, typeof secondValue);
    return super.join(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = special.toString();
console.log(typeof result, result.length, result);
console.log(calls);
