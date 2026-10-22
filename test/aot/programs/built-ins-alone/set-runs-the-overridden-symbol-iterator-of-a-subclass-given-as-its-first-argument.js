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
const result = new Set(special);
console.log(result instanceof Set, result.size, result.has(1.5));
console.log(typeof [...result][2], [...result][2].length, [...result][2], Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
