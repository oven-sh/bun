// Stores under computed keys into plain objects. Each (shape, key) pair comes once, twice or many times, so the store is seen before, at and after the point where it is cached.
const out = [];
function show(label, o) {
  const d = Object.getOwnPropertyDescriptors(o);
  out.push(label + " " + Reflect.ownKeys(o).map(k => { const p = d[k]; return String(k) + ":" + ("value" in p ? JSON.stringify(p.value) : "accessor") + ":" + (p.writable ? "w" : "-") + (p.enumerable ? "e" : "-") + (p.configurable ? "c" : "-"); }).join(" "));
}
function attempt(label, f) { try { out.push(label + " -> " + f()); } catch (e) { out.push(label + " threw " + e.constructor.name + ": " + e.message); } }
function put(o, k, v) { o[k] = v; return o; }
function putStrict(o, k, v) { "use strict"; o[k] = v; return o; }
const log = [];
const parts = ["al", "pha", "be", "ta", "gam", "ma"];
const made = i => parts[i % 6] + parts[(i + 1) % 6] + (i >> 2);

// 1. The same keys in the same order on one, two and five objects.
for (const count of [1, 2, 5]) { let last; for (let n = 0; n < count; n++) { last = {}; for (let i = 0; i < 6; i++) put(last, made(i), i * count); } show("same order x" + count, last); }
// 2. Other orders, replaced values, keys made at run time and keys that the program spells.
show("reverse", [5, 4, 3, 2, 1, 0].reduce((o, i) => put(o, made(i), i), {}));
show("replace", [0, 1, 0, 2, 1, 0].reduce((o, i, n) => put(o, made(i), n), {}));
show("spelled", ["x", "y", "x", "length", "constructor", "toString", "valueOf"].reduce((o, k, n) => put(o, k, n), { x: -1 }));
// 3. Index keys, numeric strings, negative zero, symbols and __proto__.
const sym = Symbol("key");
show("odd keys", [3, "1", "01", -0, 1.5, "4294967295", "4294967294", sym, Symbol.iterator, "", " "].reduce((o, k, n) => put(o, k, n), {}));
const withProto = put({}, "__proto__", { inherited: 1 }); show("__proto__ object", withProto); out.push(String(withProto.inherited) + " " + (Object.getPrototypeOf(withProto) !== Object.prototype));
show("__proto__ number", put({}, "__proto__", 5)); show("__proto__ made", put({}, "__pro" + "to__".slice(0), null));
show("__proto__ on null prototype", put(Object.create(null), "__proto__", 7));
// 4. Many keys: the object grows into a dictionary; deletes in between.
const big = {}; for (let i = 0; i < 100; i++) put(big, "k" + i, i); for (let i = 0; i < 100; i += 3) delete big["k" + i]; for (let i = 0; i < 12; i += 3) put(big, "k" + i, -i);
out.push(Object.keys(big).length + " " + Object.keys(big).slice(-6).join() + " " + big.k3 + " " + big.k4 + " " + big.k12);
// 5. Frozen, sealed and non-extensible receivers, read-only and accessor properties.
for (const [name, lock] of [["frozen", Object.freeze], ["sealed", Object.seal], ["not extensible", Object.preventExtensions]]) {
  attempt(name + " new sloppy", () => JSON.stringify(put(lock({ a: 1 }), made(1), 2))); attempt(name + " new strict", () => JSON.stringify(putStrict(lock({ a: 1 }), made(1), 2)));
  attempt(name + " old sloppy", () => JSON.stringify(put(lock({ a: 1 }), "a", 2))); attempt(name + " old strict", () => JSON.stringify(putStrict(lock({ a: 1 }), "a", 2)));
}
const guarded = Object.defineProperties({}, { fixed: { value: 1, enumerable: true }, both: { get() { return "got"; }, set(v) { log.push("own setter " + v); }, enumerable: true }, getter: { get() { return 1; } } });
for (const k of ["fixed", "both", "getter"]) { attempt("own " + k + " sloppy", () => JSON.stringify(put(guarded, k, 9))); attempt("own " + k + " strict", () => JSON.stringify(putStrict(guarded, k, 9))); }
// 6. Setters, read-only properties and proxies above the receiver; the chain changes between stores at one site.
const above = { set watched(v) { log.push("setter above " + v); } }; Object.defineProperty(above, "locked", { value: 1 });
for (let n = 0; n < 3; n++) { const o = Object.create(above); put(o, "watched", n); put(o, "free", n); attempt("locked above strict", () => Object.keys(putStrict(o, "locked", n))); show("below setter", o); }
const plainAbove = {}; const below = () => Object.create(plainAbove);
show("before", put(below(), "late", 1)); show("before", put(below(), "late", 2)); show("before", put(below(), "late", 3));
Object.defineProperty(plainAbove, "late", { set(v) { log.push("late setter " + v); }, configurable: true }); show("after setter", put(below(), "late", 4));
delete plainAbove.late; show("after delete", put(below(), "late", 5));
Object.defineProperty(plainAbove, "late", { value: 0, writable: false, configurable: true }); show("after read-only", put(below(), "late", 6)); attempt("after read-only strict", () => Object.keys(putStrict(below(), "late", 7)));
const traps = []; const proxied = Object.create(new Proxy({}, { set(t, k, v, r) { traps.push("set " + String(k)); return Reflect.set(t, k, v, r); } }));
show("below proxy", put(put(proxied, made(2), 1), sym, 2)); out.push(traps.join());
// 7. Keys that convert: objects with toString, numbers, booleans, null, undefined, a key whose conversion throws or changes the receiver.
show("converted", [{ toString() { log.push("toString"); return "conv"; } }, 12, true, null, undefined, 1e21, [1, 2], () => 1].reduce((o, k, n) => put(o, k, n), {}));
attempt("throwing key", () => put({}, { toString() { throw new RangeError("no key"); } }, 1));
const changing = { a: 1 }; show("key changes receiver", put(changing, { toString() { delete changing.a; changing.z = 0; return "a"; } }, 2));
// 8. Receivers that are not plain objects.
show("array", put(put([1, 2], "name", 3), "2", 4)); show("function", put(function f() {}, made(3), 1)); attempt("string strict", () => putStrict("text", made(0), 1)); attempt("string index strict", () => putStrict("text", 0, "x"));
attempt("null", () => { try { put(null, made(0), 1); } catch (e) { return e.constructor.name; } }); show("class instance", put(put(new (class P { a = 1; })(), "a", 2), made(4), 3)); show("map", put(new Map(), "size2", 1));
out.push(log.join());
console.log(out.join("\n"));
