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
  get [Symbol.isConcatSpreadable]() {
    calls++;
    this.count++;
    console.log("Symbol.isConcatSpreadable");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = special.concat("an", "an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1, result[1].double());
console.log(typeof result[2], result[2].length, result[2]);
console.log(typeof result[3], result[3].length, result[3]);
console.log(typeof result.count, result.count + 1, 1 / result.count, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
