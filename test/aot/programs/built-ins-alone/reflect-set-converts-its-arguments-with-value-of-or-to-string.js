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
const result = Reflect.set(first, probe, 3.5);
console.log(typeof result, result, typeof first, Object.keys(first).join());
console.log(typeof first.first, first.first + 1, typeof first.second, first.second.length, first.second);
console.log(first.third === item, first.third.double(), typeof first["-"], first["-"] + 1, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
