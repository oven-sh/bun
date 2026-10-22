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
const result = Promise.all(probe);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1, settled[1].double());
console.log(typeof settled[2], settled[2].length, settled[2], typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
