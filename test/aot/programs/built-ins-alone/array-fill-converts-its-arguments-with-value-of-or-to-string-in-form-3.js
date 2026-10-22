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
const thirdProbe = {
  valueOf() {
    calls++;
    console.log("thirdProbe valueOf", this === thirdProbe);
    return 3;
  },
  toString() {
    calls++;
    console.log("thirdProbe toString", this === thirdProbe);
    return "3";
  },
};
const result = list.fill(1.5, secondProbe, thirdProbe);
console.log(result === list, Array.isArray(list), list.length, typeof list[0], list[0] + 1);
console.log(list[1] === item, list[1].double(), typeof list[2], list[2] + 1);
console.log(calls);
