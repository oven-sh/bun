class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = "banana".match(item);
console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0]);
console.log(typeof result.index, result.index + 1, 1 / result.index);
console.log(typeof result.input, result.input.length, result.input, typeof result.groups, result.groups === undefined);
