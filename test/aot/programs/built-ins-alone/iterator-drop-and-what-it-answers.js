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
const result = subject.drop(1.5);
console.log(typeof result);
const step = result.next();
console.log(step.done, step.value === item, step.value.double(), [...result].length);
