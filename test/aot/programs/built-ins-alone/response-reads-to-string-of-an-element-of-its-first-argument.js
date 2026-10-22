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
  count: 0,
  toString() {
    calls++;
    this.count++;
    console.log("toString", this === probe);
    return "first";
  },
};
const holder = [probe, item, "two"];
const result = new Response(holder, second);
console.log(result instanceof Response, Object.keys(result).join(), Array.isArray(holder), holder.length, typeof holder[0]);
console.log(Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1, typeof holder[0].toString, holder[0].toString.length);
console.log(holder[1].double(), typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
