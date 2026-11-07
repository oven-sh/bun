// Prints where a stack trace places errors of `this` before super(), of what a derived constructor returns, of a catch clause that takes a null apart, and of names read before their declarations ran.
function pass(value) {
  return value;
}
const holder = { text: "text", method() {} };
let five = 5;
class Base {}
const inThisFile = /stack-positions-of-checks/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("this first", () => { class D extends Base { constructor() { this.x = 1; super(); } } new D(); });
show("this behind a call", () => { class D extends Base { constructor() { pass(1); this.x = 1; super(); } } new D(); });
show("this as argument", () => { class D extends Base { constructor() { pass(this); super(); } } new D(); });
show("this as second argument", () => { class D extends Base { constructor() { pass(1, this); super(); } } new D(); });
show("this behind a read", () => { class D extends Base { constructor() { const text = holder.text; this.x = text; super(); } } new D(); });
show("this behind a method call", () => { class D extends Base { constructor() { holder.method(); this.x = 1; super(); } } new D(); });
show("this behind new.target", () => { class D extends Base { constructor() { pass(new.target); this.x = 1; } } new D(); });
show("method of this", () => { class D extends Base { constructor() { pass(1); this.m(); } m() {} } new D(); });
show("returns this", () => { class D extends Base { constructor() { return this; } } new D(); });
show("returns this behind a call", () => { class D extends Base { constructor() { pass(1); return this; } } new D(); });
show("this in an arrow", () => { class D extends Base { constructor() { (() => this)(); } } new D(); });
show("returns", () => { class D extends Base { constructor() { return; } } new D(); });
show("returns behind calls", () => { class D extends Base { constructor() { pass(1); pass(holder.text); return; } } new D(); });
show("returns in a branch", () => { class D extends Base { constructor() { if (five) return; super(); } } new D(); });
show("returns in a block", () => { class D extends Base { constructor() { if (five) { pass(1); return; } super(); } } new D(); });
show("ends", () => { class D extends Base { constructor() {} } new D(); });
show("ends with parameters", () => { class D extends Base { constructor(a, b) {} } new D(); });
show("ends with a pattern", () => { class D extends Base { constructor({ a }) {} } new D({}); });
show("ends behind a call", () => { class D extends Base { constructor() { pass(1); } } new D(); });
show("returns a number", () => { class D extends Base { constructor() { return 1; } } new D(); });
show("returns a number behind super", () => { class D extends Base { constructor() { super(); return 1; } } new D(); });
show("returns a result", () => { class D extends Base { constructor() { super(); return pass(1); } } new D(); });
show("catch null", () => { try { throw null; } catch ({ a }) {} });
show("catch behind a call", () => { try { pass(1); throw null; } catch ({ a }) { pass(a); } });
show("catch a result", () => { try { throw pass(null); } catch ({ a }) {} });
show("catch a member", () => { try { throw holder.none; } catch ({ a }) {} });
show("catch an error", () => { try { holder.none(); } catch ({ a: { b } }) {} });
show("catch with a default", () => { try { throw null; } catch ({ a = 1 }) {} });
show("catch with a rest", () => { try { throw null; } catch ({ ...rest }) {} });
show("catch nothing", () => { try { throw null; } catch ({}) {} });
show("catch beside finally", () => { try { throw null; } catch ({ a }) {} finally { pass(1); } });
show("catch behind finally", () => { try { try { throw null; } finally { pass(1); } } catch ({ a }) {} });
show("early argument", () => { pass(late); let late = 1; });
show("early first argument", () => { pass(late, 1); let late = 1; });
show("early last argument", () => { pass(1, late); let late = 1; });
show("early element", () => { pass([late]); let late = 1; });
show("early last element", () => { pass([1, late]); let late = 1; });
show("early first element", () => { pass([late, 1]); let late = 1; });
show("early operand", () => { pass(1 + late); let late = 1; });
show("early left operand", () => { pass(late + 1); let late = 1; });
show("early negation", () => { pass(-late); let late = 1; });
show("early spread", () => { pass(...late); let late = 1; });
show("early spread element", () => { pass([...late]); let late = 1; });
show("early argument of new", () => { new Base(late); let late = 1; });
show("early inner argument", () => { pass(pass(late), 1); let late = 1; });
show("early argument of a method", () => { pass(holder.method(1, late)); let late = 1; });
show("early class", () => { pass(Late); class Late {} });
show("early member", () => { pass(late.member); let late = 1; });
show("early argument over lines", () => {
  pass(
    1,
    late,
  );
  let late = 1;
});
