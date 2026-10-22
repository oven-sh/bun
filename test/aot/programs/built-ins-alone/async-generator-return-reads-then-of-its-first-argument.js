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
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  then(resolve, reject) {
    calls++;
    this.count++;
    console.log("then", typeof resolve, typeof reject, this === probe);
    resolve(2.5);
  },
};
const result = subject.return(probe);
const settled = await result;
console.log(typeof settled, Object.keys(settled).join(), typeof settled.value, settled.value + 1);
console.log(typeof settled.done, settled.done, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
