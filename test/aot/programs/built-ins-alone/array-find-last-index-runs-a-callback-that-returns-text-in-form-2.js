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
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(thirdValue === list, typeof this, arguments.length);
  return "text";
}
const result = list.findLastIndex(callback, 2.5);
console.log(typeof result, result + 1);
