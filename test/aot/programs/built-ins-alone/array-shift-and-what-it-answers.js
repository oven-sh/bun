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
const result = list.shift();
console.log(typeof result, result + 1, Array.isArray(list), list.length);
console.log(list[0] === item, list[0].double(), typeof list[1], list[1].length, list[1]);
