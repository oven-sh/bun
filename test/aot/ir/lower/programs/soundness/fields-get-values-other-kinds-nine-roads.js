// RUN: lower
// OPTIONS: builtin-modules

// Data redefinitions with another kind of value; accessors over fields; fields over accessors.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class A { ga = { qd: 1 }; gb = 1.5; gc = "text"; gd = [1]; }
function all(o) { return [attempt(() => o.ga.qd), attempt(() => o.gb + 1), attempt(() => o.gc.length), attempt(() => o.gd.length)].join(); }
const a = new A();
Object.defineProperty(a, "ga", { value: 5 }); Object.defineProperty(a, "gb", { value: "s" }); Object.defineProperty(a, "gc", { value: undefined }); Object.defineProperty(a, "gd", { value: { length: "L" } });
console.log(all(a));
const b = new A();
Object.defineProperties(b, { ga: { value: null }, gb: { get() { return { valueOf() { return 41; } }; } }, gc: { value: 12 }, gd: { value: "abc" } });
console.log(all(b));
const c = new A();
for (const [k, v] of Object.entries({ ga: true, gb: 2n, gc: Symbol.iterator, gd: () => 1 })) c[k] = v;
console.log(all(c));
const d = Object.assign(new A(), JSON.parse('{"ga":[1],"gb":{"x":1},"gc":3,"gd":"q"}'));
console.log(all(d));
const e = new A(); Object.entries(e).forEach(([k]) => Reflect.set(e, k, k));
console.log(all(e));
const f = new A(); ({ ga: f.gb, gb: f.ga, gc: f.gd, gd: f.gc } = f);
console.log(all(f));
const g = new A(); [g.ga, g.gb, g.gc, g.gd] = [1, "2", 3, 4];
console.log(all(g));
const h = new A(); for (h.ga of [7]); for (h.gc in { k: 1 }); for (h.gb in { z: 1 });
console.log(all(h));
console.log(all(new A()));

// GENERATED: attempt all A get gd
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: Return v1
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v2 = CatchValue
// CHECK-NEXT: v3 = String string="threw "
// CHECK-NEXT: v4 = PropGet v2 key="constructor"
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="attempt"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="attempt"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="attempt"
// CHECK-NEXT: v13 = NewArray v3, v6, v9, v12 contents=anything
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Call v14, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_9]]
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_10]] fields=[0]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="gd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
