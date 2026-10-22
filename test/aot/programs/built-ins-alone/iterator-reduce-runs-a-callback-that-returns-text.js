class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = [1.5, item, "two"].values();
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue, typeof thirdValue);
  console.log(thirdValue + 1, this === undefined, arguments.length);
  return "text";
}
const result = subject.reduce(callback, 2.5);
console.log(typeof result, result.length, result);
