class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = { first: 1.5, second: "two", third: item };
const third = { first: 1.5, second: "two", third: item };
const result = Object.defineProperty(first, "-", third);
console.log(result === first, typeof first, Object.keys(first).join(), typeof first.first, first.first + 1);
console.log(typeof first.second, first.second.length, first.second, first.third === item, first.third.double());
