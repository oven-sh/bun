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
const probe = {
  first: 1.5,
  second: "two",
  third: item,
  then(resolve, reject) {
    calls++;
    console.log("then", typeof resolve, typeof reject, this === probe);
    resolve(2.5);
  },
};
const result = subject.return(probe);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), typeof settled.value, settled.value + 1);
console.log(typeof settled.done, settled.done);
console.log(calls);
