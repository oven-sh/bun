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
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, thirdValue === subject);
  console.log(this === second, arguments.length);
  return 0;
}
const result = subject.map(callback, second);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
