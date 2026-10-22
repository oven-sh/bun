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
const first = new URL("https://user:secret@example.com:8080/a/b?first=1&second=two#part");
class Special extends Array {
  count = 0;
  get method() {
    calls++;
    this.count++;
    console.log("method");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = new Request(first, special);
console.log(result instanceof Request, Object.keys(result).join(), Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
