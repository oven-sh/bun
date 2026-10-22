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
const holder = [probe, ["second", item]];
const result = Response.json(holder, null);
console.log(result instanceof Response, Object.keys(result).join(), Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, typeof holder[0].toJSON, holder[0].toJSON.length);
console.log(Array.isArray(holder[1]), holder[1].length, typeof holder[1][0], holder[1][0].length, holder[1][0]);
console.log(holder[1][1].double());
console.log(calls, probe.count);
