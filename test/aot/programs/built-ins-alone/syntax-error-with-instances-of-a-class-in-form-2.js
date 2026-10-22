class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = new SyntaxError("an", item);
console.log(result instanceof SyntaxError, result.message);
