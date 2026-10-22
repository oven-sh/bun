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
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue.length);
  console.log(secondValue, thirdValue === subject, this === item, arguments.length);
  return { made: 1.5 };
}
const result = subject.forEach(callback, item);
console.log(typeof result, result === undefined);
