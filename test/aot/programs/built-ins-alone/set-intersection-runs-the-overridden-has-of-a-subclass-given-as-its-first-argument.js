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
const set = new Set([1.5, item]);
class Special extends Set {
  count = 0;
  has(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("has", arguments.length, typeof firstValue, typeof secondValue);
    return super.has(...arguments);
  }
}
const special = new Special([1.5, item]);
console.log("made");
const result = set.intersection(special);
console.log(result instanceof Set, result.size, result.has(1.5), typeof [...result][0], [...result][0] + 1);
console.log(calls, special.count);
