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
const result = Promise.any(probe);
let reason;
try {
  await result;
} catch (error) {
  reason = error;
}
console.log(reason instanceof TypeError, reason.message, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second);
console.log(calls, probe.count);
