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
const third = { first: 1.5, second: "two", third: item };
const result = Bun.randomUUIDv5(first, second, third);
console.log(typeof result, result.length, result);
