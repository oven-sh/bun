// STATISTIC: ClosedPrototypeObjects >= 2
// `Object.create(proto)`, where the file names the literal of methods nowhere else: the new object finds the same above it.
const out = [];
function told(name, run) {
  try {
    out.push(`${name} ${run()}`);
  } catch (error) {
    out.push(`${name} ${error.name}: ${error.message}`);
  }
}
told("early", () => Object.create(counted).twice());
const counted = { twice() { return this.v * 2; } };
const account = { deposit(x) { this.total += x; return this; }, toString() { return `account of ${this.total}`; }, own: function () { return Object.keys(this).join(); } }, unit = 2;
const named = { name() { return "named"; } };
const read = { name() { return "read"; } };
function repeat(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) {
    const o = Object.create(counted);
    o.v = k & 7;
    n += o.twice();
  }
  return n;
}
function open(total) {
  const made = Object.create(account);
  made.total = total;
  return made;
}
told("repeat", () => repeat(1000));
told("account", () => String(open(1).deposit(2).deposit(unit)));
told("own", () => open(3).own());
told("in", () => { const names = []; for (const name in open(4)) names.push(name); return names.join(); });
told("constructor", () => open(5).constructor === Object);
told("same", () => Object.getPrototypeOf(open(6)) === Object.getPrototypeOf(open(7)));
told("enumerable", () => Object.keys(Object.getPrototypeOf(open(8))).join());
told("hidden", () => Object.getOwnPropertyNames(Object.getPrototypeOf(open(9))).join());
told("instance", () => open(10) instanceof Object);
told("json", () => JSON.stringify(open(11)));
told("changed", () => { Object.getPrototypeOf(open(12)).deposit = function () { return "changed"; }; return open(13).deposit(1); });
told("shadowed", () => { const Object = { create: () => ({ name: () => "shadow" }) }; return Object.create(named).name(); });
told("read", () => Object.create(read).name === read.name);
told("deep", () => Object.create(Object.create(named)).name());
told("map", () => Object.create(named, { v: { value: 5, enumerable: true } }).v);
told("text", () => Object.prototype.toString.call(Object.create(named)));
told("frozen", () => { const o = Object.freeze(Object.create(named)); o.v = 1; return o.v; });
told("quoted", () => Object.create(named).missing());
told("constructed", () => new (Object.create(named).missing)());
told("behind another", () => Object.create(Object.create(named)).missing());
told("beside operators", () => (Object.create(named) || 0).missing.name);
console.log(out.join("\n"));
