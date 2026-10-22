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
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = list.every(callback, second);
console.log(typeof result, result, Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, list[1] === item, list[1].double());
console.log(typeof list[2], list[2].length, list[2], typeof second, Object.keys(second).join());
console.log(typeof second.first, second.first + 1, typeof second.second, second.second.length, second.second);
console.log(second.third === item, second.third.double());
console.log(typeof item.size, item.size.length, item.double());
