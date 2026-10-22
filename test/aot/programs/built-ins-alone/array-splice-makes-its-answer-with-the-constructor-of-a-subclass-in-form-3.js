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
const special = new Special(1.5, item, "two");
console.log("made");
const result = special.splice(1, 2, third, "x");
console.log(Array.isArray(result), result.length, result[0].double());
console.log(typeof result[1], result[1].length, result[1], Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1] === third);
console.log(typeof special[2], special[2].length, special[2]);
console.log(calls);
