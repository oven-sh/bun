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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="f"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = String string="threw "
// CHECK-NEXT: v5 = PropGet v3 key="constructor"
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="attempt"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="attempt"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="attempt"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = NewArray v4, v8, v12, v16 contents=anything
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v18 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v21 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|number|[[L_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_12]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_10]]
// CHECK-NEXT: PropDefine v2, v1 key="valueOf"
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="gd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=1 flags=[IsExpected]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
