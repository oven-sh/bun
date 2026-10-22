class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = performance;
const second = { first: 1.5, second: "two", third: item };
const result = subject.mark("an", second);
console.log(typeof result, Object.keys(result).join());
