// A function, a bound function or a generator reaches code nobody sees. What it captures, what it is bound to and what is sent to it arrive later.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
let stash;
const box = new Proxy({}, { set(target, key, value) { stash = value; return true; }, get() { return stash; } });
function hide(value) { box.kept = value; return box.kept; }
// `seen` is undefined at run time: the field is read through a leak of `this` before its store. An analysis learns that late, and only then finds the member `undefined`.
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();

// 1: a captured variable is assigned late
{ let captured = 1; const f = () => typeof captured; const u = hide(f); show("1a", u()); const table = { early() {}, undefined() { captured = "s"; } }; table[seen](); show("1b", u()); }
// 2: one call of bind binds two functions, the second one late
{ let target = function first(x) { return typeof x; }; function bind() { return target.bind(null); } const u1 = hide(bind());
  const table = { early() {}, undefined() { target = function second(x) { return typeof x + "!"; }; } }; table[seen](); const u2 = hide(bind()); show("2", u1(1), u1("s"), u2("s"), u2(2)); }
// 3: the bound receiver is changed by a call of the hidden bound function
{ const self = { v: 1 }; function set(x) { this.v = x; } const table = { early() { return () => {}; }, undefined() { return hide(set.bind(self)); } }; table[seen]()("s"); show("3", typeof self.v); }
// 4: bound arguments
{ const first = { v: 1 }; function change(o, x) { o.v = x; } const table = { early() { return () => {}; }, undefined() { return hide(change.bind(null, first)); } }; table[seen]()("s"); show("4", typeof first.v); }
// 5: instanceof asks the target of a hidden bound class
{ class C {} const table = { early() { return Object; }, undefined() { return hide(C.bind(null)); } }; const u = table[seen](); show("5", new C() instanceof u, ({}) instanceof u); }
// 6: a hidden bound class is constructed
{ class C { constructor(v) { this.v = v; } } const table = { early() { return Object; }, undefined() { return hide(C.bind(null)); } }; const made = new (table[seen]())("s"); show("6", typeof made.v, made instanceof C); }
// 7: values are sent to a generator that is hidden late
{ const log = []; function* g() { const x = yield 1; log.push(typeof x); const y = yield x; log.push(typeof y); } const table = { early() { return [][Symbol.iterator](); }, undefined() { return hide(g()); } };
  const it = table[seen](); it.next(); it.next("s"); it.next(3); show("7", log.join()); }
// 8: what a hidden function returns is changed by its caller
{ const kept = { v: 1 }; function give() { return kept; } const table = { early() { return () => ({}); }, undefined() { return hide(give); } }; table[seen]()().v = "s"; show("8", typeof kept.v); }
// 9: what a hidden function throws is changed by whoever catches it
{ const thrown = { v: 1 }; function fail() { throw thrown; } const table = { early() { return () => {}; }, undefined() { return hide(fail); } }; try { table[seen]()(); } catch (e) { e.v = "s"; } show("9", typeof thrown.v); }
