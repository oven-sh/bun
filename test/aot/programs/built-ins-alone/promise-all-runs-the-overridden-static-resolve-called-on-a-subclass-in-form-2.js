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
const result = Special.all(first);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1);
console.log(settled[1] === item, settled[1].double(), typeof settled[2], settled[2].length, settled[2]);
console.log(result instanceof Special, calls, Special.count);
