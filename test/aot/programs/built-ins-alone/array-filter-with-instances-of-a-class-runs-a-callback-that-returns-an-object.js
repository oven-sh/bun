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
const result = list.filter(callback, item);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(result[1] === item, result[1].double(), result[2] === item, result[2].double());
