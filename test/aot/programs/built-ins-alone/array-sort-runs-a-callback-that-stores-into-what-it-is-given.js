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
function callback(firstValue, secondValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  if (secondValue instanceof Item) secondValue.size = "changed";
  return true;
}
const result = list.sort(callback);
console.log(result === list, Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(list[1] === item, list[1].double(), typeof list[2], list[2].length, list[2]);
console.log(typeof item.size, item.size.length, item.double());
