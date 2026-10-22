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
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue.length, secondValue);
  console.log(thirdValue === map, typeof this, arguments.length);
  return 0;
}
const result = map.forEach(callback, 2.5);
console.log(typeof result, result === undefined);
