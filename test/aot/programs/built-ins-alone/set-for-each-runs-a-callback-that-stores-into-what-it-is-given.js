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
  if (firstValue instanceof Item) firstValue.size = "changed";
  if (secondValue instanceof Item) secondValue.size = "changed";
  return true;
}
const result = set.forEach(callback, second);
console.log(typeof result, result === undefined, set instanceof Set, set.size, set.has(1.5));
console.log([...set][1] === item, [...set][1].double(), typeof second, Object.keys(second).join());
console.log(typeof second.first, second.first + 1, typeof second.second, second.second.length, second.second);
console.log(second.third === item, second.third.double());
console.log(typeof item.size, item.size.length, item.double());
