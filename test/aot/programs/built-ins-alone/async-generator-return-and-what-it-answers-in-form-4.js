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
const result = subject.return(first);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), settled.value === first, typeof settled.done, settled.done);
