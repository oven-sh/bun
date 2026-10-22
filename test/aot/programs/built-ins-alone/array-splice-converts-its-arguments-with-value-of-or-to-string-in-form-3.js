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
  valueOf() {
    calls++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 1;
  },
  toString() {
    calls++;
    console.log("firstProbe toString", this === firstProbe);
    return "1";
  },
};
const secondProbe = {
  valueOf() {
    calls++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2;
  },
  toString() {
    calls++;
    console.log("secondProbe toString", this === secondProbe);
    return "2";
  },
};
const result = list.splice(firstProbe, secondProbe, 3.5, "x");
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(typeof result[1], result[1].length, result[1], Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1] + 1);
console.log(typeof list[2], list[2].length, list[2]);
console.log(calls);
