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
const result = set.isSupersetOf(first);
console.log(typeof result, result);
