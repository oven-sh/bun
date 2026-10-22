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
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(thirdValue === list, this === second, arguments.length);
  return "text";
}
const result = list.findLastIndex(callback, second);
console.log(typeof result, result + 1);
