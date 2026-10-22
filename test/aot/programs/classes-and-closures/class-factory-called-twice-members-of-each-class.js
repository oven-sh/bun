class Base {
  constructor() { this.seen = this.tag; this.kind = this.describe(); }
  describe() { return "base"; }
}
const mix = (Parent, label) => class extends Parent {
  own = label;
  get tag() { return "tag of " + label; }
  describe() { return "made for " + label; }
};
const First = mix(Base, "first");
const Second = mix(Base, "second");
const Third = mix(Second, "third");
function show(o) { return o.seen + " | " + o.kind + " | " + o.own + " | " + o.tag + " | " + o.describe() + " | " + Object.keys(o).join(); }
for (const C of [Base, First, Second, Third, First, Second]) console.log(show(new C()));
console.log(new Second() instanceof First, new Third() instanceof Second, new Third() instanceof First, new First() instanceof Base);
Second.prototype.extra = "on the second";
console.log(new First().extra, new Second().extra, new Third().extra);
