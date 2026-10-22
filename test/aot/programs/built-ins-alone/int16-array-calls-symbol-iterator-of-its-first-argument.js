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
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  [Symbol.iterator](...passed) {
    calls++;
    this.count++;
    console.log("called Symbol.iterator", passed.length, passed.map(each => typeof each).join(), this === probe);
    return undefined;
  },
};
try {
  new Int16Array(probe);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
