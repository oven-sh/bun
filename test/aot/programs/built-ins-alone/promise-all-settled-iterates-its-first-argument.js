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
const result = Promise.allSettled(probe);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status, typeof settled[0].value, settled[0].value + 1);
console.log(typeof settled[1], Object.keys(settled[1]).join(), typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(settled[1].value.double(), typeof settled[2], Object.keys(settled[2]).join());
console.log(typeof settled[2].status, settled[2].status.length, settled[2].status);
console.log(typeof settled[2].value, settled[2].value.length, settled[2].value, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
