// RUN: lower
// OPTIONS: builtin-modules

// A getter may be a bound function. What it throws goes to whoever reads the property, also where the language itself reads it: Symbol.species, Symbol.toPrimitive, Symbol.iterator, then, toJSON, constructor.
let calls = 0;
const thrower = function () { calls++; throw new RangeError("getter ran"); }.bind();
const counter = function () { calls++; return 7; }.bind();
function tryIt(name, run) { try { console.log(name, run(), calls); } catch (e) { console.log(name, e.name, calls); } }
const a = {}; Object.defineProperty(a, "x", { get: thrower });
tryIt("named read", () => a.x);
tryIt("keyed read", () => a["x".trim()]);
const b = {}; Object.defineProperty(b, "x", { get: counter });
tryIt("named read of a counter", () => b.x);
const c = {}; Object.defineProperty(c, Symbol.toPrimitive, { get: thrower });
tryIt("toPrimitive", () => `${c}`);
const d = {}; Object.defineProperty(d, Symbol.iterator, { get: thrower });
tryIt("iterator", () => [...d]);
const e = {}; Object.defineProperty(e, "then", { get: thrower });
tryIt("then, by resolve", () => (Promise.resolve(e).catch(() => {}), "resolved"));
try { console.log("then, awaited", await e, calls); } catch (x) { console.log("then, awaited", x.name, calls); }
const f = []; f.constructor = {}; Object.defineProperty(f.constructor, Symbol.species, { get: thrower });
tryIt("array species, map", () => f.map(x => x).length);
const g = Promise.resolve(1); g.constructor = {}; Object.defineProperty(g.constructor, Symbol.species, { get: thrower });
tryIt("promise species, then", () => typeof g.then());
const h = Promise.resolve(1); h.constructor = {}; Object.defineProperty(h.constructor, Symbol.species, { get: counter });
tryIt("promise species, a counter", () => typeof h.then());
const i = /a/; i.constructor = {}; Object.defineProperty(i.constructor, Symbol.species, { get: thrower });
tryIt("regexp species, split", () => "bab".split(i).length);
const j = {}; Object.defineProperty(j, "toJSON", { get: thrower });
tryIt("toJSON", () => JSON.stringify(j));
const k = {}; Object.defineProperty(k, "constructor", { get: thrower }); Object.setPrototypeOf(k, Promise.prototype);
tryIt("constructor getter on a promise-like", () => { try { return Promise.prototype.then.call(k); } catch (x) { return x.name; } });
const l = Promise.resolve(1); Object.defineProperty(l, "constructor", { get: thrower });
tryIt("promise constructor getter, then", () => typeof l.then());
try { console.log("promise constructor getter, awaited", await l, calls); } catch (x) { console.log("promise constructor getter, awaited", x.name, calls); }

// GENERATED: tryIt
// CHECK-LABEL: function {{*}}name="tryIt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="calls"
// CHECK-NEXT: v10 = Call v6, v4, v0, v7, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v11 key="name"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="calls"
// CHECK-NEXT: v20 = Call v16, v14, v0, v17, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
