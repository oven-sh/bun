class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const key = { name: 1 };
const subject = new WeakMap();
const first = { first: 1.5, second: "two", third: item };
const result = subject.set(first, 2.5);
console.log(result === subject);
