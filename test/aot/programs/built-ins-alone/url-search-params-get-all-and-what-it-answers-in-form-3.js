class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new URLSearchParams("first=1&second=two&first=3");
const first = { first: 1.5, second: "two", third: item };
const result = subject.getAll(first);
console.log(Array.isArray(result), result.length);
