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
const second = { first: 1.5, second: "two", third: item };
const probe = {
  get first() {
    calls++;
    console.log("getter first", this === probe);
    return 1.5;
  },
  get second() {
    calls++;
    console.log("getter second", this === probe);
    return "two";
  },
  get third() {
    calls++;
    console.log("getter third", this === probe);
    return item;
  },
};
const result = Bun.deepMatch(probe, second);
console.log(typeof result, result);
console.log(calls);
