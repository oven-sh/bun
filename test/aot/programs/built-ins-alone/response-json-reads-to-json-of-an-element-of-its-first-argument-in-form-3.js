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
const result = Response.json(holder, 2.5);
console.log(result instanceof Response, Object.keys(result).join(), Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, typeof holder[0].toJSON, holder[0].toJSON.length);
console.log(holder[1].double(), typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
