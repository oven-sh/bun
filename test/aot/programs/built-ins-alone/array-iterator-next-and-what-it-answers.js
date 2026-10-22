class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = [item, "two"].values();
const result = subject.next();
console.log(typeof result, Object.keys(result).join(), result.value === item, result.value.double());
console.log(typeof result.done, result.done);
