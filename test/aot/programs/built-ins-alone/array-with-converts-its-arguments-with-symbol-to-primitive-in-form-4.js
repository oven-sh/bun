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
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("probe toPrimitive", hint, this === probe);
    return 1;
  },
};
const result = list.with(probe, "-");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2]);
console.log(calls);
