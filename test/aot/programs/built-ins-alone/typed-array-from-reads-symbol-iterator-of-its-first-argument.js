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
const third = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  get [Symbol.iterator]() {
    calls++;
    this.count++;
    console.log("Symbol.iterator", this === probe);
    return undefined;
  },
};
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = Uint8Array.from(probe, callback, third);
console.log(result instanceof Uint8Array, result.length, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
