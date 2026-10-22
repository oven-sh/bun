class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
async function* numbers() {
  const sent = yield 1.5;
  yield sent ?? "two";
  return item;
}
const subject = numbers();
const first = [1.5, item, "two"];
const result = subject.throw(first);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason === first);
