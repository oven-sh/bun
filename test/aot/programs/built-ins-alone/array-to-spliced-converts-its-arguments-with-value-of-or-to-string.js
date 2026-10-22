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
const result = list.toSpliced(firstProbe, secondProbe, 3.5, "x");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, typeof result[2], result[2].length, result[2]);
console.log(typeof firstProbe, Object.keys(firstProbe).join(), typeof firstProbe.count, firstProbe.count + 1);
console.log(typeof firstProbe.valueOf, firstProbe.valueOf.length, typeof firstProbe.toString, firstProbe.toString.length, typeof secondProbe);
console.log(Object.keys(secondProbe).join(), typeof secondProbe.count, secondProbe.count + 1, typeof secondProbe.valueOf, secondProbe.valueOf.length);
console.log(typeof secondProbe.toString, secondProbe.toString.length);
console.log(calls, firstProbe.count, secondProbe.count);
