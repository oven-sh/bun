// `new bound()` goes through the run time: it hands the target the bound arguments out of the closure, whatever form they have there.
function hide(callable) { return callable; }
const Meter = hide(function Meter(size, more, last) { this.size = size; this.more = more; this.last = last; });
Meter.prototype.read = function () { return [typeof this.size, String(this.size), typeof this.more, String(this.more), typeof this.last, String(this.last)].join(); };
const rows = [];
for (const [a, b] of [["bound", 1], ["other", 2.5], [true, null], [undefined, "text"], [7, { toString() { return "object"; } }], [1.5, 2n], [Symbol.iterator.description, -0]]) {
  const one = Meter.bind({ size: "ignored" }, a);
  const two = Meter.bind(null, a, b);
  rows.push(new one().read(), new one("given").read(), new two().read(), new two("given", "too many").read(), Reflect.construct(two, [3]).read());
}
const number = Meter.bind(null, 41);
const double = Meter.bind(null, 0.5, 1e300);
const flag = Meter.bind(null, false, true);
const literal = Meter.bind(null, "bound");
rows.push(new number().read(), new double().read(), new flag().read(), new literal().read());
console.log(rows.join("\n"));
