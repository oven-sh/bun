class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = "banana".split("n", item);
console.log(Array.isArray(result), result.length);
