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
const result = new Uint8Array(probe);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, 1 / result[1], typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
