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
const list = [1.5, item, "two"];
class Special extends Array {
  get [Symbol.isConcatSpreadable]() {
    calls++;
    console.log("Symbol.isConcatSpreadable");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = list.concat(special, "an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(result[1] === item, result[1].double(), typeof result[2], result[2].length, result[2]);
console.log(typeof result[3], result[3] + 1);
console.log(calls);
