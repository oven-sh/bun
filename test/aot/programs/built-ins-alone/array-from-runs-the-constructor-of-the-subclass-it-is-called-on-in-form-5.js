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
const third = { first: 1.5, second: "two", third: item };
class Special extends Array {
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === third, arguments.length);
  return true;
}
const result = Special.from("an", callback, third);
console.log(Array.isArray(result), result.length, typeof result[0], result[0]);
console.log(typeof result[1], result[1]);
console.log(result instanceof Special, calls);
