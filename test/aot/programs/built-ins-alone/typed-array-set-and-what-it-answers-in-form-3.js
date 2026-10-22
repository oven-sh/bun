class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Uint8Array([1, 2, 3]);
const first = { first: 1.5, second: "two", third: item };
const result = subject.set(first, 2);
console.log(typeof result, result === undefined);
