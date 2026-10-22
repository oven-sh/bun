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
const result = list.push("text", 1.5);
console.log(typeof result, result + 1, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, list[1] === item, list[1].double());
console.log(typeof list[2], list[2].length, list[2]);
console.log(typeof list[3], list[3].length, list[3]);
