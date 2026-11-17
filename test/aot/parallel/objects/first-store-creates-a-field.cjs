// Each store or definition below runs once or twice for its shape, so it takes the first-miss path of the run time.
// The stored values are strings out of a small set, closures, maps and class instances: types that a store by name has to test.
const out = [];
function show(label, o) {
  const d = Object.getOwnPropertyDescriptors(o);
  out.push(label + " " + Reflect.ownKeys(o).map(k => {
    const p = d[k], name = typeof k === "symbol" ? k.toString() : k;
    const flags = (p.writable ? "w" : "-") + (p.enumerable ? "e" : "-") + (p.configurable ? "c" : "-");
    return name + ":" + ("value" in p ? (typeof p.value === "function" ? "fn" : p.value instanceof Map ? "map" : JSON.stringify(p.value)) : "accessor") + ":" + flags;
  }).join(" "));
}
function attempt(label, f) { try { out.push(label + " -> " + f()); } catch (e) { out.push(label + " threw " + e.constructor.name + ": " + e.message); } }
const log = [];

// 1. Literals of several shapes get one late name.
function tag(name, options) { if (options === undefined) options = {}; options.tag = name; return options; }
show("late", tag("a")); show("late", tag("b", { x: 1 })); show("late", tag("c", { y: true, x: 2 })); show("late", tag("d", { z: null }));
const shared = { s: 1 }; tag("e", shared); tag("f", shared); show("late twice", shared);

// 2. Frozen, sealed and non-extensible receivers.
function strictTag(name, options) { "use strict"; options.tag = name; return options; }
attempt("frozen sloppy", () => JSON.stringify(tag("g", Object.freeze({ x: 1 }))));
attempt("frozen strict", () => JSON.stringify(strictTag("g", Object.freeze({ x: 1 }))));
attempt("sealed strict", () => JSON.stringify(strictTag("h", Object.seal({ x: 1, y: 2 }))));
attempt("not extensible strict", () => JSON.stringify(strictTag("i", Object.preventExtensions({ q: 1 }))));
attempt("not extensible sloppy", () => JSON.stringify(tag("i", Object.preventExtensions({ q: 2 }))));

// 3. Accessors and read-only properties above the receiver.
class WithSetter { set tag(v) { log.push("setter " + v); } get tag() { return "from getter"; } }
class BelowSetter extends WithSetter { constructor() { super(); this.own = 1; } }
attempt("setter above", () => { const o = new BelowSetter(); strictTag("j", o); return Object.keys(o) + " " + o.tag + " " + log.join(); });
class GetterOnly { get tag() { return "only getter"; } }
attempt("getter only strict", () => Object.keys(strictTag("k", new (class extends GetterOnly { a = 1; })())));
attempt("getter only sloppy", () => Object.keys(tag("k", new (class extends GetterOnly { a = 1; })())));
function ReadOnlyAbove() { this.r = 1; }
Object.defineProperty(ReadOnlyAbove.prototype, "tag", { value: "fixed", writable: false });
attempt("read-only above strict", () => Object.keys(strictTag("l", new ReadOnlyAbove())));
attempt("read-only above sloppy", () => Object.keys(tag("l", new ReadOnlyAbove())) + " " + new ReadOnlyAbove().tag);

// 4. A definition ignores what is above the receiver.
class FieldOverSetter extends WithSetter { tag = "m"; other = () => 1; }
attempt("field over setter", () => { const o = new FieldOverSetter(); show("field over setter", o); return log.length; });
class FieldOverReadOnly extends ReadOnlyAbove { tag = "n"; }
show("field over read-only", new FieldOverReadOnly());

// 5. The prototype changes between two stores at one site.
function Late() { this.first = "x"; }
function fill(o, v) { o.added = v; return o; }
show("before change", fill(new Late(), "p"));
Object.defineProperty(Late.prototype, "added", { set(v) { log.push("late setter " + v); }, configurable: true });
show("after setter", fill(new Late(), "q")); out.push(log.join());
delete Late.prototype.added;
show("after delete", fill(new Late(), "p"));

// 6. A proxy above the receiver.
const seen = [];
function BelowProxy() { this.b = 1; }
BelowProxy.prototype = new Proxy({}, { set(t, k, v, r) { seen.push("set " + String(k)); return Reflect.set(t, k, v, r); }, getOwnPropertyDescriptor(t, k) { seen.push("gopd " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, defineProperty(t, k, d) { seen.push("define " + String(k)); return Reflect.defineProperty(t, k, d); } });
show("below proxy", fill(new BelowProxy(), "p")); out.push(seen.join());

// 7. Key order: late names in different orders, with deletes and index keys between them.
function order(o, names) { for (const n of names) { if (n === "a") o.a = "one"; else if (n === "b") o.b = () => 2; else if (n === "c") o.c = new Map(); else if (n === "1") o[1] = "index"; else if (n === "-a") delete o.a; } return o; }
for (const names of [["a", "b", "c"], ["c", "b", "a"], ["b", "1", "a"], ["a", "b", "-a", "a"], ["c", "-a", "a", "1", "b"]]) show("order " + names.join(), order({ base: 0 }, names));

// 8. Symbols.
const sym = Symbol("s");
function withSymbol(o, v) { o[sym] = v; o[Symbol.toStringTag] = "T"; return o; }
show("symbols", withSymbol({ p: 1 }, "p")); show("symbols", withSymbol({ p: 1, q: 2 }, "q"));

// 9. A store of another type than the field has seen, then the first type again.
function retype(o, v) { o.kind = v; return o; }
show("retype", retype({ n: 1 }, "p")); show("retype", retype({ n: 2 }, 5)); show("retype", retype({ n: 3 }, null)); show("retype", retype({ n: 4 }, undefined)); show("retype", retype({ n: 5 }, { deep: "q" }));

// 10. Fields of a class whose instances are made through another new.target, and a base constructor that returns another object.
class Plain { one = "p"; two = () => 2; three = new Map(); four; five = undefined; }
function Other() {} Other.prototype = { marker: true };
const through = Reflect.construct(Plain, [], Other); show("other new.target", through); out.push(String(through.marker) + " " + (through instanceof Plain));
class Returns { constructor(o) { return o; } }
class Stamps extends Returns { stamp = "q"; fn = () => 1; }
show("stamped literal", new Stamps({ had: 1 })); attempt("stamped frozen", () => Object.keys(new Stamps(Object.freeze({ had: 1 }))));
attempt("stamped twice", () => { const o = { had: 2 }; new Stamps(o); new Stamps(o); show("stamped twice", o); return "ok"; });
attempt("stamped with a read-only stamp", () => { const o = {}; Object.defineProperty(o, "stamp", { value: 1, configurable: false }); return Object.keys(new Stamps(o)); });
attempt("stamped proxy", () => { const t = []; new Stamps(new Proxy({}, { defineProperty(o, k, d) { t.push(String(k) + ":" + Object.keys(d)); return Reflect.defineProperty(o, k, d); } })); return t.join(" "); });

// 11. The receiver is itself a prototype: objects below it see the new property.
function Parent() {} const proto = { base: 1 }; Parent.prototype = proto; const child = new Parent();
out.push(String(child.tag)); tag("p", proto); out.push(String(child.tag)); show("prototype", proto);

// 12. Primitives, null and undefined.
attempt("number sloppy", () => String(tag("q", 5))); attempt("number strict", () => String(strictTag("q", 5))); attempt("string strict", () => String(strictTag("q", "text")));
for (const nothing of [null, undefined]) { try { strictTag("q", nothing); } catch (e) { out.push(String(nothing) + " threw " + e.constructor.name); } }

// 13. One field moves out of its slot, then other fields are created, deleted and created again on the same object.
function moved(o, v) { o.kind = v; o.after = "p"; o.more = new Map(); return o; }
show("moved", moved({ kind: "p", n: 1 }, 5)); show("moved", moved({ kind: "q", n: 2 }, { deep: 1 })); show("not moved", moved({ kind: "p", n: 3 }, "q"));
function movedThenDeleted(o) { o.kind = 7; o.after = "q"; delete o.kind; o.kind = "p"; delete o.after; o.after = "p"; o.more = () => 1; return o; }
show("moved, deleted", movedThenDeleted({ kind: "p", n: 4 })); show("moved, deleted", movedThenDeleted({ kind: "q", n: 5 }));
function redefined(o) { Object.defineProperty(o, "kind", { value: "p", enumerable: false, configurable: true, writable: true }); o.after = "q"; o.kind = "q"; o.more = new Map(); return o; }
show("redefined", redefined({ kind: "p", n: 6 })); show("redefined", redefined({ n: 7 }));
class MovedField { kind = "p"; constructor(v) { this.kind = v; this.after = "q"; } } class BelowMoved extends MovedField { more = () => 1; last = "p"; }
show("moved in constructor", new BelowMoved(1)); show("moved in constructor", new BelowMoved("q")); show("moved in constructor", new BelowMoved(null));

// 14. Fields that hold functions: the closures that the field has seen, other closures, and callables that are not plain closures.
function setHandler(o, f) { o.handler = f; return o; }
const first = () => "first", second = () => "second"; function third() { return "third"; } const withProperty = () => "with property"; withProperty.extra = 1;
class Callee { static make() { return "static"; } method() { return "method"; } }
const makers = n => () => "made " + n;
const handlers = [first, second, first, third, withProperty, makers(1), makers(2), Callee.make, Callee.prototype.method, third.bind(null), Math.max, async () => 1, function* () {}, Callee, new Proxy(first, {}), { call() {} }, null, "text"];
for (const f of handlers) {
  const o = setHandler({ id: 1 }, f), same = o.handler === f;
  let result; try { result = typeof f === "function" && f !== Callee ? String(o.handler()) : typeof f; } catch (e) { result = e.constructor.name; }
  out.push("handler " + same + " " + Object.keys(o).join() + " " + result);
}
class Listener { onData = () => "data " + this.n; onEnd; constructor(n, end) { this.n = n; this.onEnd = end; } }
for (const end of [first, second, undefined, third, makers(3)]) { const l = new Listener(2, end); out.push("listener " + l.onData() + " " + (l.onEnd ? l.onEnd() : l.onEnd) + " " + Object.keys(l).join()); }

console.log(out.join("\n"));
/* Output:
late tag:"a":wec
late x:1:wec tag:"b":wec
late y:true:wec x:2:wec tag:"c":wec
late z:null:wec tag:"d":wec
late twice s:1:wec tag:"f":wec
frozen sloppy -> {"x":1}
frozen strict threw TypeError: Attempting to define property on object that is not extensible.
sealed strict threw TypeError: Attempting to define property on object that is not extensible.
not extensible strict threw TypeError: Attempting to define property on object that is not extensible.
not extensible sloppy -> {"q":2}
setter above -> own from getter setter j
getter only strict threw TypeError: Attempted to assign to readonly property.
getter only sloppy -> a
read-only above strict threw TypeError: Attempted to assign to readonly property.
read-only above sloppy -> r fixed
field over setter tag:"m":wec other:fn:wec
field over setter -> 1
field over read-only r:1:wec tag:"n":wec
before change first:"x":wec added:"p":wec
after setter first:"x":wec
setter j,late setter q
after delete first:"x":wec added:"p":wec
below proxy b:1:wec added:"p":wec
set b,set added
order a,b,c base:0:wec a:"one":wec b:fn:wec c:map:wec
order c,b,a base:0:wec c:map:wec b:fn:wec a:"one":wec
order b,1,a 1:"index":wec base:0:wec b:fn:wec a:"one":wec
order a,b,-a,a base:0:wec b:fn:wec a:"one":wec
order c,-a,a,1,b 1:"index":wec base:0:wec c:map:wec a:"one":wec b:fn:wec
symbols p:1:wec Symbol(s):"p":wec Symbol(Symbol.toStringTag):"T":wec
symbols p:1:wec q:2:wec Symbol(s):"q":wec Symbol(Symbol.toStringTag):"T":wec
retype n:1:wec kind:"p":wec
retype n:2:wec kind:5:wec
retype n:3:wec kind:null:wec
retype n:4:wec kind:undefined:wec
retype n:5:wec kind:{"deep":"q"}:wec
other new.target one:"p":wec two:fn:wec three:map:wec four:undefined:wec five:undefined:wec
true false
stamped literal had:1:wec stamp:"q":wec fn:fn:wec
stamped frozen threw TypeError: Attempting to define property on object that is not extensible.
stamped twice had:2:wec stamp:"q":wec fn:fn:wec
stamped twice -> ok
stamped with a read-only stamp threw TypeError: Attempting to change configurable attribute of unconfigurable property.
stamped proxy -> stamp:value,writable,enumerable,configurable fn:value,writable,enumerable,configurable
undefined
p
prototype base:1:wec tag:"p":wec
number sloppy -> 5
number strict threw TypeError: Attempted to assign to readonly property.
string strict threw TypeError: Attempted to assign to readonly property.
null threw TypeError
undefined threw TypeError
moved kind:5:wec n:1:wec after:"p":wec more:map:wec
moved kind:{"deep":1}:wec n:2:wec after:"p":wec more:map:wec
not moved kind:"q":wec n:3:wec after:"p":wec more:map:wec
moved, deleted n:4:wec kind:"p":wec after:"p":wec more:fn:wec
moved, deleted n:5:wec kind:"p":wec after:"p":wec more:fn:wec
redefined kind:"q":w-c n:6:wec after:"q":wec more:map:wec
redefined n:7:wec kind:"q":w-c after:"q":wec more:map:wec
moved in constructor kind:1:wec after:"q":wec more:fn:wec last:"p":wec
moved in constructor kind:"q":wec after:"q":wec more:fn:wec last:"p":wec
moved in constructor kind:null:wec after:"q":wec more:fn:wec last:"p":wec
handler true id,handler first
handler true id,handler second
handler true id,handler first
handler true id,handler third
handler true id,handler with property
handler true id,handler made 1
handler true id,handler made 2
handler true id,handler static
handler true id,handler method
handler true id,handler third
handler true id,handler -Infinity
handler true id,handler [object Promise]
handler true id,handler [object Generator]
handler true id,handler function
handler true id,handler first
handler true id,handler object
handler true id,handler object
handler true id,handler string
listener data 2 first onData,onEnd,n
listener data 2 second onData,onEnd,n
listener data 2 undefined onData,onEnd,n
listener data 2 third onData,onEnd,n
listener data 2 made 3 onData,onEnd,n
*/
