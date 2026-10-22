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
const result = new Set(first);
console.log(result instanceof Set, result.size, result.has(1.5));
console.log(typeof [...result][2], [...result][2].length, [...result][2]);
