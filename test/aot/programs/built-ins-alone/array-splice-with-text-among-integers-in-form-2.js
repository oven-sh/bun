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
const result = list.splice(1, 2, "text", 1.5);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(typeof result[1], result[1].length, result[1], Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1].length, list[1]);
console.log(typeof list[2], list[2] + 1);
