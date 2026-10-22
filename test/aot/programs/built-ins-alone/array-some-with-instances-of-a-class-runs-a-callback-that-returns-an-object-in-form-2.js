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
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, thirdValue === list);
  console.log(this === item, arguments.length);
  return { made: 1.5 };
}
const result = list.some(callback, item);
console.log(typeof result, result);
