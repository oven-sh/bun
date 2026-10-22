class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Intl.NumberFormat("en");
const first = { first: 1.5, second: "two", third: item };
const result = subject.format(first);
console.log(typeof result);
