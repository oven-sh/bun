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
  toString() {
    calls++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [probe, item, "two"];
const result = holder.join("an");
console.log(typeof result, result.length, result);
console.log(calls);
