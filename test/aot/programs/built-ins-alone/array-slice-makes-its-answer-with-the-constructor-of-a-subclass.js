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
  constructor(...passed) {
    super(...passed);
    calls++;
    console.log("constructor", passed.length, typeof passed[0], new.target === Special);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = special.slice(1, 2);
console.log(Array.isArray(result), result.length, result[0].double());
console.log(calls);
