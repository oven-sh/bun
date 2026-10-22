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
  count: 0,
  toJSON(key) {
    calls++;
    this.count++;
    console.log("toJSON", typeof key, this === probe);
    return { made: 1.5 };
  },
};
const holder = [probe, item, "two"];
const result = JSON.stringify(holder, 2.5, 3.5);
console.log(typeof result, result.length, result, Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1);
console.log(typeof holder[0].toJSON, holder[0].toJSON.length, holder[1].double());
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
