class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const result = JSON.parse('{ "first": 1.5, "second": ["two"] }', item);
console.log(typeof result, Object.keys(result).join(), typeof result.first, result.first + 1);
console.log(Array.isArray(result.second), result.second.length, typeof result.second[0], result.second[0].length, result.second[0]);
