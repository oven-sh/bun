// The trace of an error of a class: which constructors it leaves out, at every limit, deep, in callbacks, in generators, behind awaits, and the errors of the engine beside them. Each site runs several times.
const out = [];
const say = (name, text) => out.push(name + ": " + text);
const show = error => typeof error.stack !== "string" ? String(error.stack) : error.stack.replaceAll(/\(?[^\s(]*traces-of-errors-of-classes\.mjs/g, "F").split("\n").map(line => line.trim()).join(" | ");
class A extends Error {}
class B extends A { constructor(m) { super(m); this.name = "B"; } }
class C extends B { x = 1; constructor(...a) { super(...a); } }
class D extends Error { constructor(m) { const inner = () => super(m); inner(); } }
class E extends Error { constructor(m) { super(m); Error.captureStackTrace?.(this, E); } }
class F extends Error { constructor(m) { super(m); Object.setPrototypeOf(this, new.target.prototype); this.name = new.target.name; } }
class H extends Error { static make(m) { return new this(m); } }
class I extends H {}
class J extends Error { constructor(m) { super(m); this.inner = new A("inner " + m); } }
class K extends AggregateError { constructor(m) { super([new A("1"), new B("2")], m); } }
function L(m) { return Reflect.construct(Error, [m], L); }
L.prototype = Object.create(Error.prototype);
class N extends Error { constructor(m, n) { super(m); if (n > 0) this.next = new N(m, n - 1); } }
class O extends A { constructor(m) { super(m + new B("within").message); } }
class P extends Error { constructor(m) { const other = new A(m); super(other.message); this.inner = other; } }
const makes = { A: m => new A(m), B: m => new B(m), C: m => new C(m), D: m => new D(m), E: m => new E(m), F: m => new F(m), H: m => H.make(m), I: m => I.make(m), J: m => new J(m), K: m => new K(m), L: m => new L(m), N: m => new N(m, 2), O: m => new O(m), P: m => new P(m), either: m => new (m.length & 1 ? A : B)(m), reflectB: m => Reflect.construct(A, [m], B), spread: m => new B(...[m]), bound: m => new (B.bind(null, m))(), proxy: m => new (new Proxy(B, {}))(m) };
const inner = error => error.inner ? " / " + show(error.inner) : error.next ? " / " + show(error.next) + " / " + show(error.next.next) : error.errors ? " / " + error.errors.map(show).join(" + ") : "";
function deep(k, f) { return k === 0 ? f() : deeper(k - 1, f); }
function deeper(k, f) { const made = deep(k, f); return made; }
for (let turn = 0; turn < 3; turn++)
  for (const [name, make] of Object.entries(makes)) {
    const near = make(name); say(name, show(near) + inner(near));
    const far = deep(3, () => make(name + "deep")); say(name + " deep", show(far) + inner(far));
    const several = [1, 2].map(x => make(name + x)); say(name + " map", several.map(show).join(" + "));
  }
for (const limit of [0, 1, 2, 3, 5, 10, 100, Infinity, -1, NaN, "2", undefined, null]) {
  for (const name of ["A", "B", "C", "E", "F", "J", "L", "N", "O"]) {
    Error.stackTraceLimit = limit; let made; try { made = deep(4, () => makes[name](name)); } catch (thrown) { made = thrown; }
    Error.stackTraceLimit = 10; const own = Object.hasOwn(made, "stack"); const text = show(made);
    say("limit " + String(limit) + " " + name, own + " " + text + " " + Object.getOwnPropertyNames(made).sort().join());
  }
  Error.stackTraceLimit = limit; let thrown; try { null.x; } catch (error) { thrown = error; } Error.stackTraceLimit = 10; say("limit " + String(limit) + " of null", thrown.message + " " + show(thrown));
}
delete Error.stackTraceLimit; { const made = makes.A("gone"); Error.stackTraceLimit = 10; say("no limit", show(made)); }
const bad = { read: v => v.a.b, call: v => v.f(), callee: v => v(), make: v => new v(), key: (v, k) => v[k], spread: v => [...v], inop: v => "a" in v, inst: v => 1 instanceof v, opt: v => v?.a.b.c, set: v => { v.a = 1; }, big: () => 1n + 1, json: () => JSON.parse("{x"), rep: () => "a".repeat(-1), len: () => new Array(-1), red: () => [].reduce((a, b) => a), cb: () => [1].map(5), num: () => (1).toFixed(101) };
const args = [undefined, null, 5, "t", {}, { a: undefined }, [], () => 1, 1n, true];
for (let turn = 0; turn < 2; turn++)
  for (const [name, act] of Object.entries(bad)) for (const arg of args) { let text; try { text = "fine " + typeof act(arg, "k"); } catch (error) { text = error.constructor.name + " " + error.message + " " + show(error); } say("bad " + name + " " + typeof arg, text); }
async function later(name) { await null; const made = makes[name](name); return made; }
async function outer(name) { const made = await later(name); return made; }
for (const name of Object.keys(makes)) say("async " + name, show(await outer(name)));
function* stepped(name) { const made = makes[name](name); yield made; }
for (const name of Object.keys(makes)) say("generator " + name, show(stepped(name).next().value));
console.log(out.join("\n"));
