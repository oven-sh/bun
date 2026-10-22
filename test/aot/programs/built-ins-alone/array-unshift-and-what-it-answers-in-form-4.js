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
const first = [1.5, item, "two"];
const result = list.unshift(first, "an");
console.log(typeof result, result + 1, Array.isArray(list), list.length, list[0] === first);
console.log(typeof list[1], list[1].length, list[1], typeof list[2], list[2] + 1);
console.log(list[3] === item, list[3].double());
