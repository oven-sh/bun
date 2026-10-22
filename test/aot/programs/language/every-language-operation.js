// Sloppy script: every language operation that compiled code runs through one run-time call or inline path.
module.exports = {};

const out = console.log;

function mapped(a, b) {
  arguments[0] = "through arguments";
  b = "through name";
  return [a, b, arguments[0], arguments[1], arguments.length];
}
out(mapped());
out(mapped(1));
out(mapped(1, 2));
out(mapped(1, 2, 3));
class Strict {
  static unmapped(a) {
    arguments[0] = "written";
    return [a, arguments[0], arguments.length];
  }
}
out(Strict.unmapped(1));
function mappedCallee(a) {
  return arguments.callee === mappedCallee;
}
out(mappedCallee());

const spread = [...[], ...new Uint8Array(3), ...new Set([1]), , 5];
out(spread.length, Object.keys(spread).join(), 4 in spread, spread[5]);
const emptied = [];
out([...emptied, ...emptied].length, [1, ...emptied, 2].join());
out([..."ab", ...new Float64Array([0.5]), ...(function* () { yield 7; })()].join());

const computed = "computed";
const literal = {
  get [computed + "Get"]() { return "literal getter"; },
  set [computed + "Set"](v) { this.stored = v; },
  [computed + "Method"]() { return "literal method"; },
};
class Members {
  get [computed + "Get"]() { return "class getter"; }
  set [computed + "Set"](v) { this.stored = v; }
  [computed + "Method"]() { return "class method"; }
  static [computed + "Static"]() { return "static method"; }
}
function describe(holder, key) {
  const d = Object.getOwnPropertyDescriptor(holder, key);
  const f = d.value ?? d.get ?? d.set;
  return [key, d.enumerable, d.configurable, typeof d.get, typeof d.set, f.name].join(" ");
}
for (const key of ["computedGet", "computedSet", "computedMethod"]) {
  out(describe(literal, key));
  out(describe(Members.prototype, key));
}
out(describe(Members, "computedStatic"));
literal.computedSet = 4;
out(literal.computedGet, literal.computedMethod(), literal.stored);

const base = {
  x: "data on base",
  get viaGetter() { return this.name; },
  set viaSetter(v) { this.written = v; },
};
const derived = {
  __proto__: base,
  name: "derived",
  plain() { return super.x; },
  keyed(k) { return super[k]; },
  accessor() { return super.viaGetter; },
  absent() { return super.nothing; },
  store() { super.x = 1; return [this.x, base.x, Object.keys(this).join()]; },
  storeThroughSetter() { super.viaSetter = 2; return this.written; },
  deleted() { try { delete super.x; } catch (e) { return e.name; } return "not thrown"; },
};
out(derived.plain(), derived.keyed("x"), derived.accessor(), derived.absent());
out(derived.store(), derived.storeThroughSetter(), derived.deleted());
Object.setPrototypeOf(derived, { x: "data on other", viaGetter: "no longer an accessor" });
out(derived.plain(), derived.keyed("x"), derived.accessor(), derived.absent());

class Parent {
  static s = "static on parent";
  get viaGetter() { return "getter of " + this.name; }
  method() { return "parent method"; }
  static staticMethod() { return "parent static of " + this.name; }
}
class Child extends Parent {
  name = "child";
  read() { return [super.method(), super.viaGetter, super.nothing, super["method"]()]; }
  write() { super.added = 3; return [this.added, Object.hasOwn(Parent.prototype, "added")]; }
  static readStatic() { return [super.s, super.staticMethod(), super.nothing]; }
  static writeStatic() { super.written = 4; return [this.written, Object.hasOwn(Parent, "written")]; }
}
const child = new Child();
out(child.read(), child.write(), Child.readStatic(), Child.writeStatic());
Object.setPrototypeOf(Child.prototype, { method() { return "other method"; }, viaGetter: "other data" });
out(child.read());

function tag(strings) { return strings; }
function siteA() { return tag`a${1}b`; }
function siteB() { return tag`a${1}b`; }
out(siteA() === siteA(), siteB() === siteB(), siteA() === siteB());
out(Object.isFrozen(siteA()), siteA().raw.join("|"), tag`\unicode`[0]);
