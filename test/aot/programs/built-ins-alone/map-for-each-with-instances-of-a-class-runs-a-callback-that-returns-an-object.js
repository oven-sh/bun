class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", item], ["second", item]]);
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", firstValue === item, firstValue.double(), typeof secondValue, secondValue.length, secondValue);
  console.log(thirdValue === map, this === item, arguments.length);
  return { made: 1.5 };
}
const result = map.forEach(callback, item);
console.log(typeof result, result === undefined);
