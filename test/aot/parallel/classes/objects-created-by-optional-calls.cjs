// A prototype made by Object?.create(proto) or Object.create?.(proto), and the objects below it.
const proto = { kind: "p", step() { return this.n + 1; } };
const first = Object?.create(proto);
first.deep = function () { return "first" + this.n; };
const second = Object.create?.(proto);
second.deep = function () { return "second" + this.n; };
const third = Object?.assign(Object?.create(proto), { deep() { return "third" + this.n; } });
const fourth = Object?.setPrototypeOf({ deep() { return "fourth" + this.n; } }, proto);
function belowFirst(n) { const o = Object.create(first); o.n = n; return o; }
function belowSecond(n) { const o = Object.create(second); o.n = n; return o; }
function belowThird(n) { const o = Object.create(third); o.n = n; return o; }
function belowFourth(n) { const o = Object.create(fourth); o.n = n; return o; }
for (const make of [belowFirst, belowSecond, belowThird, belowFourth]) {
  const o = make(2);
  console.log(o.kind, o.deep?.(), o.step?.(), proto.isPrototypeOf(o), Object.getPrototypeOf(Object.getPrototypeOf(o)) === proto);
}
