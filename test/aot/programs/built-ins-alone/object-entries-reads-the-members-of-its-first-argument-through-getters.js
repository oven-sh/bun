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
  get first() {
    calls++;
    this.count++;
    console.log("getter first", this === probe);
    return 1.5;
  },
  get second() {
    calls++;
    this.count++;
    console.log("getter second", this === probe);
    return "two";
  },
  get third() {
    calls++;
    this.count++;
    console.log("getter third", this === probe);
    return item;
  },
};
const result = Object.entries(probe);
console.log(Array.isArray(result), result.length, Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0].length, result[0][0]);
console.log(typeof result[0][1], result[0][1] + 1, 1 / result[0][1], Array.isArray(result[1]), result[1].length);
console.log(typeof result[1][0], result[1][0].length, result[1][0], typeof result[1][1], result[1][1] + 1);
console.log(Array.isArray(result[2]), result[2].length, typeof result[2][0], result[2][0].length, result[2][0]);
console.log(typeof result[2][1], result[2][1].length, result[2][1], Array.isArray(result[3]), result[3].length);
console.log(typeof result[3][0], result[3][0].length, result[3][0], result[3][1].double(), typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second);
console.log(calls, probe.count);
