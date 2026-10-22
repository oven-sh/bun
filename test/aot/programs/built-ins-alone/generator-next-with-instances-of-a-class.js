class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
function* numbers() {
  const sent = yield 1.5;
  yield sent ?? "two";
  return item;
}
const subject = numbers();
const result = subject.next(item);
console.log(typeof result, Object.keys(result).join(), typeof result.value, result.value + 1);
console.log(typeof result.done, result.done);
