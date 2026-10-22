class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Buffer(first, item, item);
console.log(result instanceof Buffer, result.length);
