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
const second = [1.5, item, "two"];
function callback(firstValue, secondValue, thirdValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = list.every(callback, second);
console.log(typeof result, result, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, list[1] === item, list[1].double());
console.log(typeof list[2], list[2].length, list[2], Array.isArray(second), second.length);
console.log(typeof second[0], second[0] + 1, second[1] === item, second[1].double());
console.log(typeof second[2], second[2].length, second[2]);
console.log(typeof item.size, item.size.length, item.double());
