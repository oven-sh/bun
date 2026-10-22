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
const result = Promise.allSettled(holder);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], Object.keys(settled[0]).join());
console.log(typeof settled[0].status, settled[0].status.length, settled[0].status, typeof settled[0].value, settled[0].value + 1);
console.log(typeof settled[1], Object.keys(settled[1]).join(), typeof settled[1].status, settled[1].status.length, settled[1].status);
console.log(settled[1].value.double(), typeof settled[2], Object.keys(settled[2]).join());
console.log(typeof settled[2].status, settled[2].status.length, settled[2].status);
console.log(typeof settled[2].value, settled[2].value.length, settled[2].value, Array.isArray(holder), holder.length);
console.log(typeof holder[0], Object.keys(holder[0]).join(), typeof holder[0].count, holder[0].count + 1);
console.log(typeof holder[0].then, holder[0].then.length);
console.log(calls, probe.count);
