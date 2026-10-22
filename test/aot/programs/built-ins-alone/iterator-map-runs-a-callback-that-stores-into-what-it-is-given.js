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
function callback(firstValue, secondValue) {
  if (firstValue instanceof Item) firstValue.size = "changed";
  return true;
}
const result = subject.map(callback);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value, [...result].length);
console.log(typeof item.size, item.size.length, item.double());
