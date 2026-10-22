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
  count = 0;
  get then() {
    calls++;
    this.count++;
    console.log("then");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.return(special);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), settled.value === special, typeof settled.done, settled.done);
console.log(Array.isArray(special), special.length, typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
