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
class Special extends Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const special = new Special(1.5, item, "two");
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, thirdValue === special);
  console.log(this === second, arguments.length);
  return true;
}
console.log("made");
const result = special.flatMap(callback, second);
console.log(Array.isArray(result), result.length, typeof result[0], result[0]);
console.log(typeof result[1], result[1], typeof result[2], result[2]);
console.log(calls);
