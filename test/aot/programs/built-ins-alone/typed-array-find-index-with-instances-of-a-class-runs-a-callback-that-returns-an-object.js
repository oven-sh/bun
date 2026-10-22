class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Uint8Array([1, 2, 3]);
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, thirdValue === subject);
  console.log(this === item, arguments.length);
  return { made: 1.5 };
}
const result = subject.findIndex(callback, item);
console.log(typeof result, result + 1, 1 / result);
