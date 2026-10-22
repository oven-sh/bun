class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Array.of(item, 1.5);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(typeof result[1], result[1] + 1);
