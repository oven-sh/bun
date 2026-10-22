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
const secondProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("secondProbe toPrimitive", hint, this === secondProbe);
    return 2;
  },
};
const thirdProbe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("thirdProbe toPrimitive", hint, this === thirdProbe);
    return 3;
  },
};
const result = list.fill("an", secondProbe, thirdProbe);
console.log(result === list, Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(list[1] === item, list[1].double(), typeof list[2], list[2].length, list[2]);
console.log(calls);
