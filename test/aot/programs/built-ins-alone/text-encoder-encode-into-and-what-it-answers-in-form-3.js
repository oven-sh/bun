class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new TextEncoder();
const first = { first: 1.5, second: "two", third: item };
const second = new DataView(new ArrayBuffer(16));
const result = subject.encodeInto(first, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, second instanceof DataView, second.byteLength, second.byteOffset);
