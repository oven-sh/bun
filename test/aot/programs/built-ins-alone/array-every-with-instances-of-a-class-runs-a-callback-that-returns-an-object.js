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
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", firstValue === item, firstValue.double(), typeof secondValue, secondValue + 1, thirdValue === list);
  console.log(this === item, arguments.length);
  return { made: 1.5 };
}
const result = list.every(callback, item);
console.log(typeof result, result);
