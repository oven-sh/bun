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
const second = new DataView(new ArrayBuffer(16));
const result = Bun.randomUUIDv5(first, second, item);
console.log(typeof result, result.length, result);
