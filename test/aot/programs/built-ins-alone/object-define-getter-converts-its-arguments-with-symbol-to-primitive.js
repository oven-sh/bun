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
  [Symbol.toPrimitive](hint) {
    calls++;
    this.count++;
    console.log("probe toPrimitive", hint, this === probe);
    return "an";
  },
};
function callback() {
  console.log("callback", this === subject, arguments.length);
  return true;
}
const result = subject.__defineGetter__(probe, callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(typeof subject.first, subject.first + 1, typeof subject.second, subject.second.length, subject.second);
console.log(subject.third === item, subject.third.double(), typeof subject.an, subject.an, typeof probe);
console.log(Object.keys(probe).join(), typeof probe.count, probe.count + 1);
console.log(calls, probe.count);
