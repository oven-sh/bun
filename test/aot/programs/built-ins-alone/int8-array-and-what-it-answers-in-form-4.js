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
const result = new Int8Array(first);
console.log(result instanceof Int8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
