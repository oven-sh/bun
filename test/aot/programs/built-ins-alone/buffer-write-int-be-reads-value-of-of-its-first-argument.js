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
const subject = Buffer.from("banana and more text, 24");
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  valueOf() {
    calls++;
    this.count++;
    console.log("valueOf", this === probe);
    return "first";
  },
};
const result = subject.writeIntBE(probe, 0, 2);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, 1 / subject[0]);
console.log(typeof subject[1], subject[1] + 1, 1 / subject[1], typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double());
console.log(calls, probe.count);
