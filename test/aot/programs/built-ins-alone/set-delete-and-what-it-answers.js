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
const result = set.delete(1.5);
console.log(typeof result, result, set instanceof Set, set.size);
console.log([...set][0] === item, [...set][0].double());
