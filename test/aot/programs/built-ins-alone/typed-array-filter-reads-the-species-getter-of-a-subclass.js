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
const second = { first: 1.5, second: "two", third: item };
class Special extends Uint8Array {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return Uint8Array;
  }
}
const special = new Special([1, 2, 3]);
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, thirdValue === special);
  console.log(this === second, arguments.length);
  return true;
}
console.log("made");
const result = special.filter(callback, second);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
console.log(calls, Special.count);
