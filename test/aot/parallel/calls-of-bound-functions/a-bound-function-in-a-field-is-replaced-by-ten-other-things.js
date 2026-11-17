const kinds = {
  NOTHING: function () { },
  CLOSURE: function (holder) { holder.add = value => -value; },
  OTHERS: function (holder, other) { holder.add = other.add; },
  OTHERTHIS: function (holder, other) { holder.add = holder.addImpl.bind(other); },
  COUNT: function (holder) { holder.add = holder.addImpl.bind(holder, 100); },
  OTHERTARGET: function (holder) { holder.add = function (value) { return this.step + value; }.bind(holder); },
  NATIVE: function (holder) { holder.add = Math.abs; },
  PROXY: function (holder) { holder.add = new Proxy(holder.addImpl.bind(holder), { apply() { return 9000; } }); },
  TWICE: function (holder) { holder.add = holder.addImpl.bind(holder).bind(null); },
  GETTER: function (holder) { Object.defineProperty(holder, "add", { get() { return () => 11; }, configurable: true }); },
  NUMBER: function (holder) { holder.add = 5; },
};
for (const [name, change] of Object.entries(kinds)) {
  class Counter { total = 0; step; add; constructor(step) { this.step = step; this.add = this.addImpl.bind(this); } addImpl(value) { this.total += value * this.step; return this.total; } }
  function drive(counter, turns) { let last = 0; for (let turn = 0; turn < turns; turn++) last += counter.add(turn & 7); return last; }
  const counter = new Counter(3), other = new Counter(5);
  const first = drive(counter, 10);
  change(counter, other);
  let second; try { second = [drive(counter, 10), counter.total, other.total].join(" "); } catch (error) { second = error.constructor.name + ": " + error.message; }
  console.log(name + "|" + first + "|" + second);
}
