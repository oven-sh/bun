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
const result = list.toSpliced(1, 2, item, 3.5);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(result[1] === item, result[1].double(), typeof result[2], result[2] + 1);
