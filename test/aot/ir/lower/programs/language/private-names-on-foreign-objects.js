// RUN: lower
// OPTIONS: builtin-modules

// Private names on foreign objects.
const say = (...a) => console.log(a.map(v => typeof v === "string" ? v : typeof v === "symbol" ? v.toString() : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "function" ? "function" : v === undefined ? "undefined" : JSON.stringify(v)).join(" "));
const tryIt = (n, f) => { try { say(n, f()); } catch (e) { say(n, "throws", e && e.constructor ? e.constructor.name : String(e)); } };
const log = [];
class Base { constructor(o) { return o; } }
class Stamp extends Base { #p = 1; #m() { return "m" + this.#p; } get #a() { return "a" + this.#p; } set #a(v) { this.#p = v; } static has(o) { return #p in o; } static hasM(o) { return #m in o; } static get(o) { return o.#p; } static set(o, v) { o.#p = v; return o.#p; } static call(o) { return o.#m(); } static acc(o) { o.#a = 5; return o.#a; } static setM(o) { o.#m = 1; } }
class Point { constructor() { this.x = 1; this.y = 2; } }
const targets = { literal: () => ({ a: 1 }), instance: () => new Point(), frozen: () => Object.freeze({ a: 1 }), frozenInstance: () => Object.freeze(new Point()), sealed: () => Object.seal(new Point()), inextensible: () => Object.preventExtensions({}), array: () => [1, 2], proxy: () => new Proxy({}, { defineProperty() { log.push("trap"); return true; }, has() { log.push("has trap"); return true; }, get() { log.push("get trap"); } }), fn: () => function () {}, arrow: () => () => 1, klass: () => class {}, typed: () => new Uint8Array(2), map: () => new Map(), date: () => new Date(0), nullProto: () => Object.create(null), args: () => (function () { return arguments; })(1), str: () => new String("s"), promise: () => Promise.resolve(), regexp: () => /x/, error: () => new Error("e"), bound: () => function () {}.bind(), generator: () => (function* () {})(), global: () => globalThis, symbolObject: () => Object(Symbol()), module: () => Math };
for (const [n, make] of Object.entries(targets)) {
  const o = make();
  tryIt(n + " before", () => [Stamp.has(o), Stamp.hasM(o)]);
  tryIt(n + " get before", () => Stamp.get(o));
  tryIt(n + " stamp", () => new Stamp(o) === o);
  tryIt(n + " after", () => [Stamp.has(o), Stamp.hasM(o), Stamp.get(o), Stamp.set(o, 7), Stamp.call(o), Stamp.acc(o)]);
  tryIt(n + " twice", () => new Stamp(o) === o);
  tryIt(n + " set method", () => Stamp.setM(o));
  tryIt(n + " keys", () => [Reflect.ownKeys(o).length, Object.isFrozen(o), Object.isExtensible(o), JSON.stringify(o)?.length]);
}
for (const v of [1, "s", null, undefined, true, 1n, Symbol.iterator]) { tryIt("in " + String(v), () => Stamp.has(v)); tryIt("get " + String(v), () => Stamp.get(v)); tryIt("set " + String(v), () => Stamp.set(v, 1)); tryIt("stamp " + String(v), () => typeof new Stamp(v)); }
say(log);

// GENERATED: Stamp #a setM inextensible promise regexp symbolObject
// CHECK-LABEL: function {{*}}name="Stamp"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_3]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="a"
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = PrivateGet v2, v3 layout=[[L_2]] field=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Add v1, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: PrivateSet v2, v4, v3 layout=[[L_2]] field=1
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setM"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = PrivateGet v0, v2 layout=[[L_2]]
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=PrivateMethodWrite
// CHECK-NEXT: Throw v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inextensible"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectPreventExtensions
// CHECK-NEXT: v2 = Data data=[[d_7]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeName="Object.preventExtensions"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="promise"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="resolve"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|Promise flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="regexp"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|RegExp flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRegExp pattern="x"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|RegExp flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="symbolObject"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=Symbol
// CHECK-NEXT: v2 = Call v1 calleeName="Symbol" callNumber=32
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|symbol flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v0, -, v3 calleeName="Object"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
