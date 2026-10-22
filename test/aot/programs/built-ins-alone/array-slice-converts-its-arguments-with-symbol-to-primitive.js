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
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("firstProbe toPrimitive", hint, this === firstProbe);
    return 1;
  },
};
const secondProbe = {
  count: 0,
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const result = list.slice(firstProbe, secondProbe);
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double(), typeof firstProbe);
console.log(Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1);
console.log(calls, firstProbe.count, secondProbe.count);
