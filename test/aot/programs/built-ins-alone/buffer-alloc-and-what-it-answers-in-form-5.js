class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const second = { first: 1.5, second: "two", third: item };
const result = Buffer.alloc(1.5, second, 3.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
