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
const result = Promise.all(probe);
const settled = await result;
console.log(Array.isArray(settled), settled.length, Array.isArray(settled[0]), settled[0].length);
console.log(typeof settled[0][0], settled[0][0].length, settled[0][0], typeof settled[0][1], settled[0][1] + 1);
console.log(Array.isArray(settled[1]), settled[1].length, typeof settled[1][0], settled[1][0].length, settled[1][0]);
console.log(settled[1][1].double(), typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
