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
const result = subject.return(item);
console.log(typeof result, Object.keys(result).join(), result.value === item, result.value.double());
console.log(typeof result.done, result.done);
