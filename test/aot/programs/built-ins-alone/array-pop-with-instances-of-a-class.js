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
const result = list.pop();
console.log(result === item, result.double(), Array.isArray(list), list.length);
console.log(list[0] === item, list[0].double(), list[1] === item, list[1].double());
