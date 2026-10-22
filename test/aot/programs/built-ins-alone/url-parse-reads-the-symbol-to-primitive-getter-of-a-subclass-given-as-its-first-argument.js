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
  get [Symbol.toPrimitive]() {
    calls++;
    this.count++;
    console.log("Symbol.toPrimitive");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = URL.parse(special, 2.5);
console.log(result === null, Array.isArray(special), special.length, typeof special[0], special[0] + 1);
console.log(special[1].double(), typeof special[2], special[2].length, special[2]);
console.log(typeof special.count, special.count + 1);
console.log(calls, special.count);
