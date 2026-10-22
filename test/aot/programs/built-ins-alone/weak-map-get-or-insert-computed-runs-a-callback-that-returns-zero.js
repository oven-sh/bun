class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const key = { name: 1 };
const subject = new WeakMap([[key, item]]);
const first = { first: 1.5, second: "two", third: item };
function callback(firstValue) {
  console.log("callback", firstValue === first, this === undefined, arguments.length);
  return 0;
}
const result = subject.getOrInsertComputed(first, callback);
console.log(typeof result, result + 1, 1 / result);
