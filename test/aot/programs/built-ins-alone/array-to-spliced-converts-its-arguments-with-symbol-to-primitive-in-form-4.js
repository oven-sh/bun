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
const firstProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 1;
  },
};
const secondProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const result = list.toSpliced(firstProbe, secondProbe, "x", "x");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1].length, result[1]);
console.log(typeof result[2], result[2].length, result[2]);
console.log(calls);
