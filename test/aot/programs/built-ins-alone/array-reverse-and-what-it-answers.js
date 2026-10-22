class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const list = [1.5, item, "two"];
const result = list.reverse();
console.log(result === list, Array.isArray(list), list.length);
console.log(typeof list[0], list[0].length, list[0], list[1] === item, list[1].double());
console.log(typeof list[2], list[2] + 1);
