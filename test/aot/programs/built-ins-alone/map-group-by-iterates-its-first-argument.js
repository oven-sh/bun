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
const items = [1.5, item, "two"];
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
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return true;
}
const result = Map.groupBy(probe, callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get(true)), result.get(true).length);
console.log(typeof result.get(true)[0], result.get(true)[0] + 1, result.get(true)[1].double());
console.log(typeof result.get(true)[2], result.get(true)[2].length, result.get(true)[2], [...result.keys()].join(), typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
