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
  [Symbol.iterator](...passed) {
    calls++;
    this.count++;
    console.log("called Symbol.iterator", passed.length, passed.map(each => typeof each).join(), this === probe);
    return undefined;
  },
};
const holder = [probe, ["second", item]];
try {
  new URLSearchParams(holder);
} catch (error) {
  console.log(error instanceof TypeError, error instanceof RangeError);
}
console.log(calls, probe.count);
