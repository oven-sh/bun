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
const result = list.concat(item, 1.5);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(result[1] === item, result[1].double(), result[2] === item, result[2].double());
console.log(result[3] === item, result[3].double());
