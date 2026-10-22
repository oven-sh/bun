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
const result = Array.from(probe);
console.log(Array.isArray(result), result.length, Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0].length, result[0][0], typeof result[0][1], result[0][1] + 1);
console.log(Array.isArray(result[1]), result[1].length, typeof result[1][0], result[1][0].length, result[1][0]);
console.log(result[1][1].double(), typeof probe, Object.keys(probe).join(), Array.isArray(probe[0]), probe[0].length);
console.log(typeof probe[0][0], probe[0][0].length, probe[0][0], typeof probe[0][1], probe[0][1] + 1);
console.log(Array.isArray(probe[1]), probe[1].length, typeof probe[1][0], probe[1][0].length, probe[1][0]);
console.log(probe[1][1].double(), typeof probe.count, probe.count + 1, typeof probe.length, probe.length + 1);
console.log(calls, probe.count);
