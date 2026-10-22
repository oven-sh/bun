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
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue);
  console.log(typeof thirdValue, thirdValue + 1, this === undefined, arguments.length);
  return "text";
}
const result = subject.reduce(callback, "-");
console.log(typeof result, result.length, result);
