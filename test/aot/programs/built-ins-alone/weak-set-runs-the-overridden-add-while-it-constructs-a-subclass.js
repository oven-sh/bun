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
const first = [["first", 1.5], ["second", item]];
class Special extends WeakSet {
  count = 0;
  add(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("add", arguments.length, typeof firstValue, typeof secondValue);
    return super.add(...arguments);
  }
}
const result = new Special(first);
console.log(typeof result);
console.log(result instanceof Special, calls, result.count);
