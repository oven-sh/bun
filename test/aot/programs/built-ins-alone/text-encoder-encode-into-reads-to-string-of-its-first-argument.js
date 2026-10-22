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
const subject = new TextEncoder();
const second = new DataView(new ArrayBuffer(16));
const probe = {
  count: 0,
  first: 1.5,
  second: "two",
  third: item,
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const result = subject.encodeInto(probe, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, typeof probe, Object.keys(probe).join());
console.log(typeof probe.count, probe.count + 1, typeof probe.first, probe.first + 1);
console.log(typeof probe.second, probe.second.length, probe.second, probe.third.double(), second instanceof DataView);
console.log(second.byteLength, second.byteOffset);
console.log(calls, probe.count);
