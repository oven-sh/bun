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
console.log("made");
const result = special.splice(1, 2, "x", "x");
console.log(Array.isArray(result), result.length, result[0].double());
console.log(typeof result[1], result[1].length, result[1], Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, typeof special[1], special[1].length, special[1]);
console.log(typeof special[2], special[2].length, special[2]);
console.log(calls);
