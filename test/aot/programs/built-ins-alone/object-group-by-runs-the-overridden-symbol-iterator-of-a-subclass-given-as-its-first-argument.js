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
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return true;
}
console.log("made");
const result = Object.groupBy(special, callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.true), result.true.length);
console.log(typeof result.true[0], result.true[0] + 1, result.true[1].double());
console.log(typeof result.true[2], result.true[2].length, result.true[2], Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
