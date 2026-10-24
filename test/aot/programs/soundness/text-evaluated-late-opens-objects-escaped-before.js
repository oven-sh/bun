// Text that nobody knows at build time is evaluated in a function that is found late. It changes objects, functions and built-in objects that the program has used before.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
let stash;
const box = new Proxy({}, { set(target, key, value) { stash = value; return true; }, get() { return stash; } });
function hide(value) { box.kept = value; return box.kept; }
// `seen` is undefined at run time: the field is read through a leak of `this` before its store. An analysis learns that late, and only then finds the member `undefined`.
class Leaking { constructor() { leak(this); this.key = "early"; } }
let seen;
function leak(o) { seen = o.key; }
new Leaking();

function evaluateLate(text) { const table = { early() {}, undefined() { return (0, eval)(hide(text)); } }; return table[seen](); }
const o = { a: 1, m() { return 1; } };
globalThis.o = o;
const hidden = { a: 1 };
const u = hide(hidden);
globalThis.get = () => u;
class A { constructor() { this.t = new.target === A ? "self" : "other"; } }
globalThis.A = A;
function f(x) { return typeof x; }
globalThis.f = f;
const list = [1, 2];
globalThis.list = list;
const accessed = { a: 1 };
globalThis.accessed = accessed;
const deleted = { a: 1, b: 2 };
globalThis.deleted = deleted;
show("before", typeof o.a, o.m(), typeof hidden.a, new A().t, f(1), list.length, accessed.a, deleted.a, JSON.parse("2"), JSON.stringify({ a: 1 }), "abc".at(0));
evaluateLate("o.a = 's'; o.m = function () { return 'patched'; }; Object.setPrototypeOf(o, { p: 1 })");
show("1", typeof o.a, o.m(), typeof o.p);
evaluateLate("get().a = 's'");
show("2", typeof hidden.a);
const made = evaluateLate("Reflect.construct(A, [], function Other() {})");
show("3", made.t, made instanceof A);
show("4", evaluateLate("f('s') + f()"));
evaluateLate("list.push('s'); list[0] = {}; list.length = 5");
show("5", list.length, typeof list[0], typeof list[2], typeof list[4]);
evaluateLate("Object.defineProperty(accessed, 'a', { get() { return 'from getter'; } })");
show("6", accessed.a);
evaluateLate("delete deleted.a");
show("7", deleted.a, "a" in deleted, Object.keys(deleted).join());
