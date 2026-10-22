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
  then(resolve, reject) {
    calls++;
    this.count++;
    console.log("then", typeof resolve, typeof reject, this === probe);
    resolve(2.5);
  },
};
const holder = [probe, item, "two"];
const result = Promise.race(holder);
const settled = await result;
console.log(settled.double(), Array.isArray(holder), holder.length, typeof holder[0], Object.keys(holder[0]).join());
console.log(typeof holder[0].count, holder[0].count + 1, typeof holder[0].then, holder[0].then.length, holder[1].double());
console.log(typeof holder[2], holder[2].length, holder[2]);
console.log(calls, probe.count);
