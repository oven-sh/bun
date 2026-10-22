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
const result = set.add("an");
console.log(result === set, set instanceof Set, set.size, set.has(1.5));
console.log(typeof [...set][2], [...set][2].length, [...set][2]);
