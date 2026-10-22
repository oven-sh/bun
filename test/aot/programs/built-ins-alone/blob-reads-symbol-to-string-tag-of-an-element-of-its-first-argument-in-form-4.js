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
  get [Symbol.toStringTag]() {
    calls++;
    console.log("Symbol.toStringTag", this === probe);
    return undefined;
  },
};
const holder = [probe, item, "two"];
const result = new Blob(holder, 2.5);
console.log(result instanceof Blob, Object.keys(result).join());
console.log(calls);
