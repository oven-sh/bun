class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = "banana".padEnd(8, item);
console.log(typeof result, result.length, result);
