class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new TextDecoder();
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const second = [1.5, item, "two"];
const result = subject.decode(first, second);
console.log(typeof result, result.length, result);
