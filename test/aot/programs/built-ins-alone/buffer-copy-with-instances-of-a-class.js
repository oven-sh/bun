class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = Buffer.from("banana and more text, 24");
const first = new DataView(new ArrayBuffer(16));
const result = subject.copy(first, item, item, item);
console.log(typeof result, result + 1, 1 / result);
