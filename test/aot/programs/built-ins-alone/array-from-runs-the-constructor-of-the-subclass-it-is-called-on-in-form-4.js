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
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = Special.from(1.5, callback, third);
console.log(Array.isArray(result), result.length);
console.log(result instanceof Special, calls);
