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
const second = [["first", 1.5], ["second", item]];
const result = Object.create(first, second);
console.log(typeof result, Object.keys(result).join());
