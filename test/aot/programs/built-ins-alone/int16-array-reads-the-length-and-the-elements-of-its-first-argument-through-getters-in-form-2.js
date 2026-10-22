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
const probe = {
  count: 0,
  get length() {
    calls++;
    this.count++;
    console.log("length");
    return 2;
  },
  get 0() {
    calls++;
    this.count++;
    console.log("element 0");
    return ["first", 1.5];
  },
  get 1() {
    calls++;
    this.count++;
    console.log("element 1");
    return ["second", item];
  },
};
const result = new Int16Array(probe);
console.log(result instanceof Int16Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1], typeof probe, Object.keys(probe).join());
console.log(Array.isArray(probe[0]), probe[0].length, typeof probe[0][0], probe[0][0].length, probe[0][0]);
console.log(typeof probe[0][1], probe[0][1] + 1, Array.isArray(probe[1]), probe[1].length);
console.log(typeof probe[1][0], probe[1][0].length, probe[1][0], probe[1][1].double());
console.log(typeof probe.count, probe.count + 1, typeof probe.length, probe.length + 1);
console.log(calls, probe.count);
