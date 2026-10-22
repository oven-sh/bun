class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const set = new Set([1.5, item]);
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue, thirdValue === set);
  console.log(this === second, arguments.length);
  return { made: 1.5 };
}
const result = set.forEach(callback, second);
console.log(typeof result, result === undefined);
