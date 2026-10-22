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
const result = process.hrtime(first);
console.log(Array.isArray(result), result.length, typeof result[0], typeof result[1]);
