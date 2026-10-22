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
const result = Map.groupBy(special, callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get(true)), result.get(true).length);
console.log(typeof result.get(true)[0], result.get(true)[0] + 1, result.get(true)[1].double());
console.log(typeof result.get(true)[2], result.get(true)[2].length, result.get(true)[2], [...result.keys()].join());
console.log(Array.isArray(special), special.length, typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
