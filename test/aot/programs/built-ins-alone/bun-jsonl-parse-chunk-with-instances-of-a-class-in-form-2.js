class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = Bun.JSONL.parseChunk(item, item, item);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, 1 / result.read, typeof result.done, result.done);
console.log(result.error instanceof SyntaxError, result.error.message);
