let calls = 0;
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
class Special extends Array {
  get then() {
    calls++;
    console.log("then");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.return(special);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), settled.value === special, typeof settled.done, settled.done);
console.log(calls);
