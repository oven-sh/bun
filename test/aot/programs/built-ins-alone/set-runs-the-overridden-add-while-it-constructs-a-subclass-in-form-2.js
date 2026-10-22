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
class Special extends Set {
  count = 0;
  add(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("add", arguments.length, typeof firstValue, typeof secondValue);
    return super.add(...arguments);
  }
}
const result = new Special(first);
console.log(typeof result, result.size, result.has(1.5));
console.log(typeof [...result][2], [...result][2].length, [...result][2]);
console.log(result instanceof Special, calls, result.count);
