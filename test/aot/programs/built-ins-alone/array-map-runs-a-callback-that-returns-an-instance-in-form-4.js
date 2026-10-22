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
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, thirdValue === list);
  console.log(this === second, arguments.length);
  return new Item(2.5);
}
const result = list.map(callback, second);
console.log(Array.isArray(result), result.length, result[0].double(), result[1].double(), result[2].double());
