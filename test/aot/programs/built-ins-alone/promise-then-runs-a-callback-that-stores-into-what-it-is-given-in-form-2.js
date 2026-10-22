class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const promise = new Promise(resolve => resolve(item));
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = promise.then(callback, second);
const settled = await result;
console.log(typeof settled, settled, typeof second, Object.keys(second).join());
console.log(typeof second.first, second.first + 1, typeof second.second, second.second.length, second.second);
console.log(second.third === item, second.third.double());
console.log(typeof item.size, item.size.length, item.double());
