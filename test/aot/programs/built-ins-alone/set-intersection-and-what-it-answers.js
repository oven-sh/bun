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
const first = new Set([1.5, item]);
const result = set.intersection(first);
console.log(result instanceof Set, result.size, result.has(1.5), [...result][1] === item, [...result][1].double());
