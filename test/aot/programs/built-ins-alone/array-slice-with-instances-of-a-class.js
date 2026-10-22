class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [item, item, item];
const result = list.slice(1, 2);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
