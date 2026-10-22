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
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [probe, ["second", item]];
const result = subject.encodeInto(holder, second);
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, typeof holder[0].toString, holder[0].toString.length);
console.log(Array.isArray(holder[1]), holder[1].length, typeof holder[1][0], holder[1][0].length, holder[1][0]);
console.log(holder[1][1].double(), second instanceof DataView, second.byteLength, second.byteOffset);
console.log(calls, probe.count);
