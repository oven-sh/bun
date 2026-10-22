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
const result = subject.take(1.5);
console.log(typeof result);
const step = result.next();
console.log(step.done, typeof step.value, step.value + 1, [...result].length);
