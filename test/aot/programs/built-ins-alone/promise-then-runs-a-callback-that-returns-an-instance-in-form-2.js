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
  console.log("callback", firstValue === item, firstValue.double(), this === undefined, arguments.length);
  return new Item(2.5);
}
const result = promise.then(callback, second);
const settled = await result;
console.log(settled.double());
