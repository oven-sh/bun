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
const result = Bun.JSONL.parse(first);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
