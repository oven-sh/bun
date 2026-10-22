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
const probe = {
  [Symbol.toPrimitive](hint) {
    calls++;
    console.log("Symbol.toPrimitive", hint, this === probe);
    return "first";
  },
};
const holder = [probe, item, "two"];
const result = new Blob(holder, 2.5);
console.log(result instanceof Blob, Object.keys(result).join());
console.log(calls);
