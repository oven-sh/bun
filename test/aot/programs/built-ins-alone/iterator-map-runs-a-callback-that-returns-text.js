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
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return "text";
}
const result = subject.map(callback);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value.length, step.value, [...result].length);
