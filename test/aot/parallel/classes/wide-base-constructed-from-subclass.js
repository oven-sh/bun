// The constructor of a base class with many fields is entered by super(..) from three classes below it, by `new` on itself and by Reflect.construct, in turn and with collections in between.
// Each object has the prototype, the fields and the key order of what was constructed.
class Wide {
  constructor(options, tag) {
    this.a0 = tag; this.a1 = 1; this.a2 = "two"; this.a3 = null; this.a4 = undefined; this.a5 = 5.5; this.a6 = [6]; this.a7 = { seven: 7 };
    this.f0 = () => this.a0; this.f1 = () => this.a1 + 1; this.f2 = x => x + this.a2; this.f3 = () => this.name();
    this.b0 = new Set(); this.b1 = new Map(); this.b2 = true; this.b3 = false; this.b4 = -1; this.b5 = 2 ** 40; this.b6 = "b6"; this.b7 = Symbol.for("b7");
    this.update = more => { this.options = { ...this.options, ...more }; if (!this.late) this.late = tag + ":late"; };
    this.update({ first: 1, ...options });
    for (let i = 0; i < 3; i++) this.b0.add(i + tag.length);
    if (options && options.extra) this[options.extra] = "extra";
  }
  name() { return "Wide"; }
}
class Left extends Wide {
  constructor(options) { super(options, "left"); }
  name() { return "Left"; }
}
class Right extends Wide {
  own = "own field";
  constructor(options) { super(options, "right"); this.after = this.f3(); }
  name() { return "Right"; }
}
function Plain() {}
// What stands behind `extends` is the result of a call: only the run says which constructor super(..) enters.
function chosen() { return globalThis.neverSet ? Plain : Wide; }
class Far extends chosen() {
  constructor(options) { super(options, "far"); }
  name() { return "Far"; }
}
Plain.prototype.name = function () { return "Plain"; };
function describe(o) {
  return [Object.getPrototypeOf(o).constructor.name, o.name(), o.f0(), o.f1(), o.f2("x"), o.f3(), Object.keys(o).length, Object.keys(o).slice(-4).join(), JSON.stringify(o.options), o.late, o instanceof Wide, o instanceof Left, o instanceof Right, [...o.b0].join()].join(" | ");
}
const seen = new Map();
for (let i = 0; i < 3000; i++) {
  let o;
  switch (i % 6) {
  case 0: o = new Left({ i: i % 2 }); break;
  case 1: o = new Right({ extra: i % 3 ? "x" : "y" }); break;
  case 2: o = new Wide(undefined, "wide"); break;
  case 4: o = new Far({ far: i % 2 }); break;
  case 3: o = Reflect.construct(Wide, [{ r: 1 }, "reflected"], i % 2 ? Left : Plain); break;
  default: o = new Left(null); break;
  }
  const text = describe(o);
  seen.set(text, (seen.get(text) ?? 0) + 1);
  if (i % 700 === 699) Bun.gc(true);
}
for (const [text, count] of [...seen].sort()) console.log(count, text);
Object.setPrototypeOf(Left.prototype, Plain.prototype);
const later = new Left({ later: true });
console.log(later.name(), later instanceof Wide, later instanceof Plain, Object.keys(later).length, later.f3());
