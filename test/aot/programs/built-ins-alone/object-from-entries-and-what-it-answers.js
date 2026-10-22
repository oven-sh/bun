class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = [["first", 1.5], ["second", item]];
const result = Object.fromEntries(first);
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first + 1);
console.log(result.second === item, result.second.double());
