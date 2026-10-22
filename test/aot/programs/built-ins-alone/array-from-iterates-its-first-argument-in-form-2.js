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
const items = [["first", 1.5], ["second", item]];
const probe = {
  count: 0,
  [Symbol.iterator]() {
    calls++;
    this.count++;
    console.log("iterator", this === probe);
    return {
      index: 0,
      next() {
        calls++;
        console.log("next", arguments.length);
        return this.index < items.length ? { done: false, value: items[this.index++] } : { done: true, value: undefined };
      },
      return() {
        calls++;
        console.log("return");
        return {};
      },
    };
  },
};
const result = Array.from(probe);
console.log(Array.isArray(result), result.length, Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0].length, result[0][0], typeof result[0][1], result[0][1] + 1);
console.log(Array.isArray(result[1]), result[1].length, typeof result[1][0], result[1][0].length, result[1][0]);
console.log(result[1][1].double(), typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
