class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = performance;
const result = subject.getEntriesByName(item, item);
console.log(Array.isArray(result), result.length);
