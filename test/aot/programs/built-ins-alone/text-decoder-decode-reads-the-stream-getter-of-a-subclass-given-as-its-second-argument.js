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
const subject = new TextDecoder();
const first = new ArrayBuffer(8, { maxByteLength: 16 });
class Special extends Array {
  count = 0;
  get stream() {
    calls++;
    this.count++;
    console.log("stream");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.decode(first, special);
console.log(typeof result, result.length, result, Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
