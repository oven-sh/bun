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
  if (secondValue instanceof Item) secondValue.size = "changed";
  return true;
}
const result = subject.reduce(callback, "-");
console.log(typeof result, result);
console.log(typeof item.size, item.size.length, item.double());
