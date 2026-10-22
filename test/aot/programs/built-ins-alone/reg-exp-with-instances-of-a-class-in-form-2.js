class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = new RegExp(item);
console.log(result instanceof RegExp, result.source, result.flags, result.lastIndex);
