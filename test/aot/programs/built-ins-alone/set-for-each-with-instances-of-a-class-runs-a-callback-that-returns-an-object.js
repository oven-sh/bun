class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const set = new Set([item]);
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", firstValue === item, firstValue.double(), secondValue === item, secondValue.double(), thirdValue === set);
  console.log(this === item, arguments.length);
  return { made: 1.5 };
}
const result = set.forEach(callback, item);
console.log(typeof result, result === undefined);
