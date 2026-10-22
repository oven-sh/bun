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
const first = { first: 1.5, second: "two", third: item };
const third = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "-";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "-";
  },
};
const result = Object.defineProperty(first, probe, third);
console.log(result === first, typeof first, Object.keys(first).join(), typeof first.first, first.first + 1);
console.log(typeof first.second, first.second.length, first.second, first.third === item, first.third.double());
console.log(typeof probe, Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(typeof probe.valueOf, probe.valueOf.length, typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
