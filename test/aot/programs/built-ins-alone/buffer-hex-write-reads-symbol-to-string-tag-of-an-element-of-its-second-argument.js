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
  get [Symbol.toStringTag]() {
    calls++;
    this.count++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [probe, item, "two"];
const result = subject.hexWrite("an", holder, 3.5);
console.log(typeof result, result + 1, 1 / result, Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, holder[1].double());
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
