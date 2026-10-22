class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: 1.5, second: "two", third: item };
const result = subject.hasOwnProperty("an");
console.log(typeof result, result);
