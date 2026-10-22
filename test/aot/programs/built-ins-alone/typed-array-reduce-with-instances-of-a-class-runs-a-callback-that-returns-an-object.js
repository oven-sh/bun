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
function callback(firstValue, secondValue, thirdValue, fourthValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, typeof thirdValue);
  console.log(thirdValue + 1, fourthValue === subject, this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = subject.reduce(callback, item);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1);
