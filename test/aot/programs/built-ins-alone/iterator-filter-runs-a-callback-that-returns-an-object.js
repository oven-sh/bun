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
  return { made: 1.5 };
}
const result = subject.filter(callback);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);
