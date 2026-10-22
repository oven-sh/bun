class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [["first", 1.5], ["second", item]];
const result = new WeakSet(first);
console.log(result instanceof WeakSet);
