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
  valueOf() {
    calls++;
    this.count++;
    console.log("firstProbe valueOf", this === firstProbe);
    return 1;
  },
  toString() {
    calls++;
    this.count++;
    console.log("firstProbe toString", this === firstProbe);
    return "1";
  },
};
const secondProbe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("secondProbe valueOf", this === secondProbe);
    return 2;
  },
  toString() {
    calls++;
    this.count++;
    console.log("secondProbe toString", this === secondProbe);
    return "2";
  },
};
const result = list.splice(firstProbe, secondProbe, 3.5, "x");
console.log(Array.isArray(result), result.length, result[0] === item, result[0].double());
console.log(typeof result[1], result[1].length, result[1], Array.isArray(list), list.length);
console.log(typeof list[0], list[0] + 1, typeof list[1], list[1] + 1);
console.log(typeof list[2], list[2].length, list[2], typeof firstProbe, Object.keys(firstProbe).join());
console.log(typeof firstProbe.count, firstProbe.count + 1, typeof firstProbe.valueOf, firstProbe.valueOf.length);
console.log(typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe, Object.keys(secondProbe).join());
console.log(typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count);
