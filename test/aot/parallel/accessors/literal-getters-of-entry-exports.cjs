// STATISTIC: AccessesUnknown <= 40
const log = [];
let counter = 0;
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class Deep extends Point { constructor(x) { super(x, 1); this.z = x * 2; } sum() { return super.sum() + this.z; } }
const make = i => i % 3 ? new Point(i, 2) : new Deep(i);
function total(n) { let t = 0; for (let i = 0; i < n; i++) t += make(i).sum(); return t; }
module.exports = {
  get Point() { log.push("Point " + (this === module.exports)); return Point; },
  get Deep() { counter++; return Deep; },
  get make() { this.made = make(counter); return make; },
  set total(value) { log.push("set"); },
  get last() { return this.made ? this.made.sum() : "nothing made"; },
  get gone() { delete this.after; log.push("gone"); return 1; },
  get after() { log.push("after"); return 2; },
  value: new Point(1, 2),
};
log.push("end of body " + total(60));
Promise.resolve().then(() => log.push("microtask"));
setTimeout(() => {
  const all = module.exports;
  console.log(log.join("\n"));
  console.log(counter, all.value.sum(), all.made && all.made.sum(), all.last, Object.keys(all).join(), all.after);
  console.log(total(30), new all.Deep(4).sum(), all.make(2).sum(), all.total);
}, 1);
