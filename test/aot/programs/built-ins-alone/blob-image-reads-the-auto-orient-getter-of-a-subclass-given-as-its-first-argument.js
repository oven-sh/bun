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
const subject = new Blob(["[1.5", ", 2]"], { type: "text/plain" });
class Special extends Array {
  count = 0;
  get autoOrient() {
    calls++;
    this.count++;
    console.log("autoOrient");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = subject.image(special);
console.log(typeof result, Object.keys(result).join(), Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
