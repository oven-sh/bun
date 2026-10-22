class A extends Array {
  constructor(...list) { super(...list); this.kind = this.describe(); }
  describe() { return "A"; }
}
class B extends A {
  extra = "x";
  static get [Symbol.species]() { return which; }
  describe() { return "B"; }
}
class Other { constructor(n) { this.n = n; this.kind = "Other"; } }
function Plain(n) { this.n = n; this.kind = "Plain"; }
let which;
function show(label, o) { console.log(label, o.constructor.name, o.kind, o.extra, o.length, o.n, o[0], o[1], o instanceof B, o instanceof A, Object.keys(o).join()); }
const b = new B(1, 2, 3);
for (const [label, species] of [["A", A], ["Array", Array], ["Other", Other], ["Plain", Plain], ["undefined", undefined], ["null", null], ["B", B]]) {
  which = species;
  show(label + " map", b.map(x => x + 1));
  show(label + " filter", b.filter(x => x > 1));
  show(label + " slice", b.slice(0, 2));
}
