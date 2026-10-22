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
function callback(firstValue) {
  console.log("callback", firstValue === item, firstValue.double(), this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = subject.getOrInsertComputed(item, callback);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
