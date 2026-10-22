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
const result = list.splice(1, 2, item, 3.5);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(result[1] === item, result[1].double(), Array.isArray(list), list.length);
console.log(list[0] === item, list[0].double(), list[1] === item, list[1].double());
console.log(typeof list[2], list[2] + 1);
