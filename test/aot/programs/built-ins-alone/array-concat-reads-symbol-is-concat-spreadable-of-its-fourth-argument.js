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
const first = [1.5, item, "two"];
const second = [1.5, item, "two"];
const third = [1.5, item, "two"];
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  get [Symbol.isConcatSpreadable]() {
    calls++;
    this.count++;
    console.log("Symbol.isConcatSpreadable", this === probe);
    return undefined;
  },
};
const result = list.concat(first, second, third, probe, "an");
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(result[1] === item, result[1].double(), typeof result[2], result[2].length, result[2]);
console.log(typeof result[3], result[3] + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
