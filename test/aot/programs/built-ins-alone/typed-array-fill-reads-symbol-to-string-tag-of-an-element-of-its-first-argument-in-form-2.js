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
const subject = new Uint8Array([1, 2, 3]);
const probe = {
  count: 0,
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [probe, ["second", item]];
const result = subject.fill(holder, 2, 3);
console.log(result === subject, subject instanceof Uint8Array, subject.length, typeof subject[0], subject[0] + 1);
console.log(typeof subject[1], subject[1] + 1, Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, Array.isArray(holder[1]), holder[1].length);
console.log(typeof holder[1][0], holder[1][0].length, holder[1][0], holder[1][1].double());
console.log(calls, probe.count);
