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
const subject = { first: 1.5, second: "two", third: item };
const probe = {
  count: 0,
  valueOf() {
    calls++;
    this.count++;
    console.log("probe valueOf", this === probe);
    return "an";
  },
  toString() {
    calls++;
    this.count++;
    console.log("probe toString", this === probe);
    return "an";
  },
};
function callback() {
  console.log("callback", arguments.length);
  return true;
}
const result = subject.__defineSetter__(probe, callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(typeof subject.first, subject.first + 1, typeof subject.second, subject.second.length, subject.second);
console.log(subject.third === item, subject.third.double(), typeof subject.an, subject.an === undefined, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1, typeof probe.valueOf, probe.valueOf.length);
console.log(typeof probe.toString, probe.toString.length);
console.log(calls, probe.count);
