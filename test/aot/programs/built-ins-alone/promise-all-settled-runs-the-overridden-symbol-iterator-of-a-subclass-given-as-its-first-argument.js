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
class Special extends Array {
  count = 0;
  [Symbol.iterator](firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("Symbol.iterator", arguments.length, typeof firstValue, typeof secondValue);
    return super[Symbol.iterator](...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = Promise.allSettled(special);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status, typeof settled[0].value, settled[0].value + 1);
console.log(typeof settled[1], Object.keys(settled[1]).join(), typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(settled[1].value.double(), typeof settled[2], Object.keys(settled[2]).join());
console.log(typeof settled[2].status, settled[2].status.length, settled[2].status);
console.log(typeof settled[2].value, settled[2].value.length, settled[2].value, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2]);
console.log(calls, special.count);
