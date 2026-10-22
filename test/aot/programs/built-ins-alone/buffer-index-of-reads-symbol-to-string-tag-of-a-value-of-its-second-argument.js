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
const first = new Uint8Array([1, 2, 3]);
const probe = {
  count: 0,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [["first", probe], ["second", item]];
const result = subject.indexOf(first, holder, 3.5, 4.5);
console.log(typeof result, result + 1, Array.isArray(holder), holder.length);
console.log(Array.isArray(holder[0]), holder[0].length, typeof holder[0][0], holder[0][0].length, holder[0][0]);
console.log(typeof holder[0][1], Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
