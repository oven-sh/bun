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
/* Output:
same order x1 alpha0:0:wec phabe0:1:wec beta0:2:wec tagam0:3:wec gamma1:4:wec maal1:5:wec
same order x2 alpha0:0:wec phabe0:2:wec beta0:4:wec tagam0:6:wec gamma1:8:wec maal1:10:wec
same order x5 alpha0:0:wec phabe0:5:wec beta0:10:wec tagam0:15:wec gamma1:20:wec maal1:25:wec
reverse maal1:5:wec gamma1:4:wec tagam0:3:wec beta0:2:wec phabe0:1:wec alpha0:0:wec
replace alpha0:5:wec phabe0:4:wec beta0:3:wec
spelled x:2:wec y:1:wec length:3:wec constructor:4:wec toString:5:wec valueOf:6:wec
odd keys 0:3:wec 1:1:wec 3:0:wec 4294967294:6:wec 01:2:wec 1.5:4:wec 4294967295:5:wec :9:wec  :10:wec Symbol(key):7:wec Symbol(Symbol.iterator):8:wec
__proto__ object 
1 true
__proto__ number 
__proto__ made 
__proto__ on null prototype __proto__:7:wec
70 k97,k98,k0,k3,k6,k9 -3 4 undefined
frozen new sloppy -> {"a":1}
frozen new strict threw TypeError: Attempting to define property on object that is not extensible.
frozen old sloppy -> {"a":1}
frozen old strict threw TypeError: Attempted to assign to readonly property.
sealed new sloppy -> {"a":1}
sealed new strict threw TypeError: Attempting to define property on object that is not extensible.
sealed old sloppy -> {"a":2}
sealed old strict -> {"a":2}
not extensible new sloppy -> {"a":1}
not extensible new strict threw TypeError: Attempting to define property on object that is not extensible.
not extensible old sloppy -> {"a":2}
not extensible old strict -> {"a":2}
own fixed sloppy -> {"fixed":1,"both":"got"}
own fixed strict threw TypeError: Attempted to assign to readonly property.
own both sloppy -> {"fixed":1,"both":"got"}
own both strict -> {"fixed":1,"both":"got"}
own getter sloppy -> {"fixed":1,"both":"got"}
own getter strict threw TypeError: Attempted to assign to readonly property.
locked above strict threw TypeError: Attempted to assign to readonly property.
below setter free:0:wec
locked above strict threw TypeError: Attempted to assign to readonly property.
below setter free:1:wec
locked above strict threw TypeError: Attempted to assign to readonly property.
below setter free:2:wec
before late:1:wec
before late:2:wec
before late:3:wec
after setter 
after delete late:5:wec
after read-only 
after read-only strict threw TypeError: Attempted to assign to readonly property.
below proxy beta0:1:wec Symbol(key):2:wec
set beta0,set Symbol(key)
converted 12:1:wec conv:0:wec true:2:wec null:3:wec undefined:4:wec 1e+21:5:wec 1,2:6:wec () => 1:7:wec
throwing key threw RangeError: no key
key changes receiver z:0:wec a:2:wec
array 0:1:wec 1:2:wec 2:4:wec length:3:w-- name:3:wec
function length:0:--c name:"f":--c prototype:{}:w-- tagam0:1:wec
string strict threw TypeError: Attempted to assign to readonly property.
string index strict threw TypeError: Attempted to assign to readonly property.
null -> TypeError
class instance a:2:wec gamma1:3:wec
map size2:1:wec
own setter 9,own setter 9,setter above 0,setter above 1,setter above 2,late setter 4,toString
*/
