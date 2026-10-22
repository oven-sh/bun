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
const result = Bun.hash.wyhash(first, item);
console.log(typeof result, result + 1n);
