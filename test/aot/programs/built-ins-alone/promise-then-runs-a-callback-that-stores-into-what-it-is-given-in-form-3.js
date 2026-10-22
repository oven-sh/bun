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
function callback(firstValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = promise.then(callback, 2.5);
const settled = await result;
console.log(typeof settled, settled);
console.log(typeof item.size, item.size.length, item.double());
