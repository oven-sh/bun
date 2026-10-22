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
class Special extends Array {
  count = 0;
  valueOf(firstValue, secondValue) {
    calls++;
    this.count++;
    console.log("valueOf", arguments.length, typeof firstValue, typeof secondValue);
    return super.valueOf(...arguments);
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.base64urlWrite("an", special, 3.5);
console.log(typeof result, result + 1, subject instanceof Buffer, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1);
console.log(Array.isArray(special), special.length, typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
