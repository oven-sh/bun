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
const first = [1.5, item, "two"];
class Special extends Promise {
  static count = 0;
  static resolve(firstValue) {
    calls++;
    this.count++;
    console.log("static resolve", arguments.length, typeof firstValue, this === Special);
    return super.resolve(...arguments);
  }
}
const result = Special.race(first);
const settled = await result;
console.log(typeof settled, settled + 1);
console.log(result instanceof Special, calls, Special.count);
