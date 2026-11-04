// RUN: lower
// OPTIONS: builtin-modules

// Operations of the language and of the built-ins that throw, each inside try.
const log = (...a) => console.log(a.map(String).join(" "));
const t = (n, f) => { try { log(n, "value", typeof f()); } catch (e) { log(n, e.constructor.name); } };


t(8, () => new Array(-1)); t(9, () => { const a = []; a.length = -1; return a; }); t(10, () => { const a = []; a.length = 2 ** 32; return a; }); t(11, () => new Array(1.5)); t(12, () => "a".repeat(-1)); t(13, () => (1).toFixed(101)); t(14, () => (1).toString(1)); t(15, () => String.fromCodePoint(-1)); t(16, () => "a".normalize("x"));
t(17, () => 1n + 1); t(18, () => Symbol() + ""); t(19, () => `${Symbol()}`); t(20, () => +Symbol()); t(21, () => +1n); t(22, () => 2n ** -1n); t(23, () => 1n / 0n); t(24, () => BigInt(1.5)); t(25, () => 1n << (2n ** 64n)); t(26, () => Math.max(1n)); t(27, () => 1n >>> 0n); t(28, () => BigInt.asIntN(-1, 1n));
t(29, () => ({}) instanceof 5); t(30, () => "a" in "b"); t(31, () => { const { x } = null; return x; }); t(32, () => [...5]); t(33, () => { const [a] = {}; return a; }); t(34, () => new (class A extends Object { constructor() { } })()); t(35, () => new (class A extends Object { constructor() { super(); super(); } })()); t(36, () => new (class A extends null { })()); t(37, () => class A extends 5 { }); t(38, () => { function* g() { it.next(); yield 1; } const it = g(); return it.next(); });
t(39, () => decodeURIComponent("%")); t(40, () => new RegExp("(")); t(41, () => JSON.parse("{")); t(42, () => { const c = {}; c.c = c; return JSON.stringify(c); }); t(43, () => JSON.stringify(1n)); t(44, () => structuredClone(() => 1)); t(45, () => new Intl.NumberFormat("xx-invalid-locale-zzzzzzzzzzzz")); t(46, () => new Date(NaN).toISOString()); t(47, () => new ArrayBuffer(2 ** 53)); t(48, () => new Uint8Array(-1)); t(49, () => new Uint32Array(new ArrayBuffer(3))); t(50, () => new DataView(new ArrayBuffer(1)).getInt32(0));
t(51, () => Object.defineProperty(Object.freeze({}), "x", { value: 1 })); t(52, () => Object.setPrototypeOf(Object.preventExtensions({}), {})); t(53, () => { const a = {}, b = Object.create(a); Object.setPrototypeOf(a, b); }); t(54, () => Reflect.ownKeys(1)); t(55, () => new WeakMap().set(1, 1)); t(56, () => new WeakRef(1)); t(57, () => Symbol.keyFor("x")); t(58, () => new Symbol()); t(59, () => new (() => { })()); t(60, () => Promise.resolve.call(1)); t(61, () => Map.prototype.get.call({}, 1)); t(62, () => [].reduce((a, b) => a)); t(63, () => Array.from({ length: -1 }).length); t(64, () => Array.from({ length: 2 ** 53 })); t(65, () => [].at.call(null)); t(66, () => "".at.call(undefined)); t(67, () => new Proxy({}, null)); t(68, () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy.x; }); t(69, () => Object.fromEntries([1])); t(70, () => new Set(5)); t(71, () => (void 0)()); t(72, () => null.x); t(73, () => { undefined.x = 1; }); t(74, () => { "use strict"; "s".x = 1; }); t(75, () => { "use strict"; undeclared75 = 1; }); t(76, () => typeof undeclared76); t(77, () => undeclared77);

// GENERATED: log t g
// CHECK-LABEL: function {{*}}name="log"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v0 key="map"
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v6, v0, v7 calleeKey="map" calleeName="a.map"
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = Call v5, v3, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="t"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = String string="value"
// CHECK-NEXT: v5 = Call v1 calleeName="f"
// CHECK-NEXT: v6 = TypeOf v5
// CHECK-NEXT: v7 = Call v3, -, v0, v4, v6 calleeName="log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="log"
// CHECK-NEXT: v11 = PropGet v8 key="constructor"
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Call v10, -, v0, v12 calleeName="log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: anything, v2: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="it"
// CHECK-NEXT: v6 = PropGet v5 key="next"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="next" calleeName="it.next"
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Yield v8
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
