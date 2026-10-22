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
const result = Object.values(probe);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, typeof result[2], result[2].length, result[2]);
console.log(result[3].double(), typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.first, probe.first + 1, typeof probe.second, probe.second.length, probe.second);
console.log(probe.third.double());
console.log(calls, probe.count);
