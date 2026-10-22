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
const result = new AggregateError(first, "-", 3.5);
console.log(result instanceof AggregateError, result.message);
