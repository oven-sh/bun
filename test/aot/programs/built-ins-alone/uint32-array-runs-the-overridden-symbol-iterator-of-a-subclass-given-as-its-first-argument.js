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
const result = new Uint32Array(special);
console.log(result instanceof Uint32Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, 1 / result[1], Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
