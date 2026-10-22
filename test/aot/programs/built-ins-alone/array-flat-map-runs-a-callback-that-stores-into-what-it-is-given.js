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
const result = list.flatMap(callback, second);
console.log(Array.isArray(result), result.length, typeof result[0], result[0]);
console.log(typeof result[1], result[1], typeof result[2], result[2]);
console.log(Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(list[1] === item, list[1].double(), typeof list[2], list[2].length, list[2]);
console.log(typeof second, Object.keys(second).join(), typeof second.first, second.first + 1);
console.log(typeof second.second, second.second.length, second.second, second.third === item, second.third.double());
console.log(typeof item.size, item.size.length, item.double());
