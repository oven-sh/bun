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
const result = list.push(item, 1.5);
console.log(typeof result, result + 1, Array.isArray(list), list.length);
console.log(list[0] === item, list[0].double(), list[1] === item, list[1].double());
console.log(list[2] === item, list[2].double(), list[3] === item, list[3].double());
