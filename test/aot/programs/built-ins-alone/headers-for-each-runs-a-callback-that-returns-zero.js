class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Headers({ first: "1", second: "two" });
const second = { first: 1.5, second: "two", third: item };
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue.length);
  console.log(secondValue, thirdValue === subject, this === second, arguments.length);
  return 0;
}
const result = subject.forEach(callback, second);
console.log(typeof result, result === undefined);
