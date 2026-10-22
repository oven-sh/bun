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
const first = [1.5, item, "two"];
class Special extends Array {
  static count = 0;
  static get [Symbol.species]() {
    calls++;
    this.count++;
    console.log("Symbol.species", this === Special);
    return Array;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = special.concat(first, 2.5, "-");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1, result[1].double());
console.log(typeof result[2], result[2].length, result[2], typeof result[3], result[3] + 1);
console.log(calls, Special.count);
