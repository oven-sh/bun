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
const result = special.slice(1, 2);
console.log(Array.isArray(result), result.length, result[0].double());
console.log(calls);
