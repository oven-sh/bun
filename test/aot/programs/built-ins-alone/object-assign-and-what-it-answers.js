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
const result = Object.assign(first, 2.5, "-");
console.log(result === first, typeof first, Object.keys(first).join());
console.log(typeof first[0], first[0].length, first[0], typeof first.first, first.first + 1);
console.log(typeof first.second, first.second.length, first.second, first.third === item, first.third.double());
