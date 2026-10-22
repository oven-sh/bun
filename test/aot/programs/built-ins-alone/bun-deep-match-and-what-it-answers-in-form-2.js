class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [1.5, item, "two"];
const second = { first: 1.5, second: "two", third: item };
const result = Bun.deepMatch(first, second);
console.log(typeof result, result);
