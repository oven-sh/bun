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
  static get [Symbol.species]() {
    calls++;
    console.log("Symbol.species", this === Special);
    return Array;
  }
}
const special = new Special(1.5, item, "two");
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, thirdValue === special);
  console.log(typeof this, arguments.length);
  return true;
}
console.log("made");
const result = special.filter(callback, 2.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1, result[1].double());
console.log(typeof result[2], result[2].length, result[2]);
console.log(calls);
