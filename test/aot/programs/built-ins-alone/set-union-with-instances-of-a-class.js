class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const set = new Set([item]);
const first = new Set([item]);
const result = set.union(first);
console.log(result instanceof Set, result.size, [...result][0] === item, [...result][0].double());
