// `this` of derived constructors: before super(), after it, in branches, loops, handlers, arrows, twice, never; results of every kind.
const log = [];
class P { constructor(a) { if (a === "throws") throw new RangeError("parent"); if (a === "other") return { other: 1 }; this.p = a; } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + String(o) : o.constructor.name + JSON.stringify(Object.entries(o).map(([k, v]) => [k, typeof v === "object" && v ? "o" : v])); }
function attempt(f) { try { return show(f()); } catch (e) { return e.constructor.name + " " + e.message; } }
const classes = {
  Straight: class extends P { constructor(a) { super(a); this.x = a; this.y = 2; this.z = this.x; } },
  Never: class extends P { constructor(a) { log.push(a); } },
  NeverAndReturns: class extends P { constructor(a) { return; } },
  NeverButObject: class extends P { constructor(a) { return { made: a }; } },
  Before: class extends P { constructor(a) { this.early = a; super(a); } },
  BeforeCaught: class extends P { constructor(a) { try { this.early = a; } catch (e) { log.push(e.constructor.name); } super(a); this.late = a; } },
  InBranch: class extends P { constructor(a) { if (a) super(a); this.x = a; } },
  InBoth: class extends P { constructor(a) { if (a) super(a); else super(0); this.x = a; return undefined; } },
  Conditional: class extends P { constructor(a) { a ? super(1) : super(2); this.x = a; } },
  And: class extends P { constructor(a) { a && super(a); this.x = a; } },
  Twice: class extends P { constructor(a) { super(a); super(a); this.x = a; } },
  TwiceCaught: class extends P { constructor(a) { super(a); try { super(a); } catch (e) { log.push(e.constructor.name); } this.x = a; } },
  InLoop: class extends P { constructor(a) { for (let i = 0; i < a; i++) { if (i === 1) super(a); if (i > 1) this["k" + i] = i; } this.x = a; } },
  OnceInLoop: class extends P { constructor(a) { do { super(a); } while (false); for (let i = 0; i < 3; i++) this["k" + i] = i; } },
  InTry: class extends P { constructor(a) { try { super(a); this.inTry = 1; } catch (e) { log.push(e.constructor.name); } this.x = a; } },
  InFinally: class extends P { constructor(a) { try { log.push("try"); } finally { super(a); } this.x = a; } },
  AfterThrow: class extends P { constructor(a) { try { super("throws"); } catch { super(a); } this.x = a; } },
  InSwitch: class extends P { constructor(a) { switch (a) { case 1: super(a); break; case 2: super(a); default: log.push("default"); } this.x = a; } },
  InArrow: class extends P { constructor(a) { const call = () => super(a); if (a) call(); this.x = a; const read = () => this.x; log.push(read()); } },
  ArrowTwice: class extends P { constructor(a) { const call = () => super(a); call(); call(); } },
  InDefault: class extends P { constructor(a, b = super(a), c = this.p) { this.x = c; } },
  InArgument: class extends P { constructor(a) { super(a ? a : this); this.x = 1; } },
  Returns: class extends P { constructor(a) { super(a); if (a === 1) return; if (a === 2) return { r: 2 }; if (a === 3) return 3; if (a === 4) return null; if (a === 5) return this; this.x = a; return undefined; } },
  ReturnsInTry: class extends P { constructor(a) { super(a); try { if (a) return; this.x = 1; } finally { this.f = 1; } } },
  Fields: class extends P { f = 1; g = this.p; #h = 2; constructor(a) { log.push("first"); super(a); this.x = this.#h; } },
  Labelled: class extends P { constructor(a) { out: { super(a); if (a) break out; this.y = 1; } this.x = 1; } },
  Value: class extends P { constructor(a) { const t = super(a); log.push(t === this); t.x = 1; this.y = 2; } },
  NewTarget: class extends P { constructor(a) { super(a); this.n = new.target === classes.NewTarget; } },
  Deep: class extends (class extends P { constructor(a) { super(a); this.middle = 1; } }) { constructor(a) { super(a); this.x = this.middle; } },
  OfNull: class extends null { constructor(a) { return Object.create(new.target.prototype, { x: { value: a, enumerable: true } }); } },
  Nothing: class { constructor(a) { if (a) return undefined; this.x = 1; return; } },
};
for (let round = 0; round < 30; round++) for (const [name, C] of Object.entries(classes)) for (const a of [0, 1, 2, 3, 4, 5, undefined, "other", "throws"]) { const r = attempt(() => new C(a)); if (round % 29 === 0) console.log(name, String(a), r); }
for (const [name, C] of Object.entries(classes)) console.log(name, attempt(() => Reflect.construct(C, [1], P)), attempt(() => Reflect.construct(C, [2], class Other {})), attempt(() => C(1)));
for (const [name, C] of Object.entries(classes)) { if (Object.getPrototypeOf(C) !== P) continue; Object.setPrototypeOf(C, class Q { constructor(a) { this.q = a; } }); console.log(name, attempt(() => new C(1)), attempt(() => new C(0))); }
console.log(log.length, log.slice(0, 80).map(String).join("|"));
