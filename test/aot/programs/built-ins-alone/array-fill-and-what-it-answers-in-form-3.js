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
const first = { first: 1.5, second: "two", third: item };
const result = list.fill(first, 2, 3);
console.log(result === list, Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(list[1] === item, list[1].double(), list[2] === first);
