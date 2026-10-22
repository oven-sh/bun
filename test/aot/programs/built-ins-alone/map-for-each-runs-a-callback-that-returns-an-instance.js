class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const map = new Map([["first", 1.5], ["second", item]]);
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue.length, secondValue);
  console.log(thirdValue === map, this === second, arguments.length);
  return new Item(2.5);
}
const result = map.forEach(callback, second);
console.log(typeof result, result === undefined);
