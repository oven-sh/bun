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
  if (firstValue instanceof Item) firstValue.size = "changed";
  if (secondValue instanceof Item) secondValue.size = "changed";
  return true;
}
const result = set.forEach(callback, 2.5);
console.log(typeof result, result === undefined, set instanceof Set, set.size, set.has(1.5));
console.log([...set][1] === item, [...set][1].double());
console.log(typeof item.size, item.size.length, item.double());
