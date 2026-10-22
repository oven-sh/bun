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
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue, thirdValue === set);
  console.log(typeof this, arguments.length);
  return "text";
}
const result = set.forEach(callback, 2.5);
console.log(typeof result, result === undefined);
