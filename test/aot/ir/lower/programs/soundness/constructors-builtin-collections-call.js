// RUN: lower
// OPTIONS: builtin-modules

// The constructor of a built-in collection calls the adder of the object it is making.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
class M extends Map { tagM = { qa: 1 }; set(k, v) { seen.push(attempt(() => this.tagM.qa)); return super.set(k, v); } }
class S extends Set { tagS = { qa: 2 }; add(v) { seen.push(attempt(() => this.tagS.qa)); return super.add(v); } }
class WM extends WeakMap { tagW = { qa: 3 }; set(k, v) { seen.push(attempt(() => this.tagW.qa)); return super.set(k, v); } }
class WS extends WeakSet { tagV = { qa: 4 }; add(v) { seen.push(attempt(() => this.tagV.qa)); return super.add(v); } }
const m = new M([[1, 2]]); m.set(3, 4);
const s = new S([1]); s.add(2);
const wm = new WM([[{}, 2]]); wm.set({}, 4);
const ws = new WS([{}]); ws.add({});
console.log(seen.join("|"), m.size, s.size);

// GENERATED: attempt mayThrow M set
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
// CHECK-LABEL: function {{*}}name="mayThrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="mayThrow"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="M"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_2]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="attempt"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v13 = GetSuperBase v12 homeKind=ClassPrototype
// CHECK-NEXT: v14 = SuperGet v13, v0 key="set"
// CHECK-NEXT: v15 = Call v14, v0, v1, v2 calleeName="super.set"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|[[L_1]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_9]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|[[L_9]] flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = NewClosure v0 function=[[f_11]]
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="attempt"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v6, v4, v10 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v13 = GetSuperBase v12 homeKind=ClassPrototype
// CHECK-NEXT: v14 = SuperGet v13, v0 key="set"
// CHECK-NEXT: v15 = Call v14, v0, v1, v2 calleeName="super.set"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|[[L_9]] flags=[IsExpected]}}]
// CHECK-NEXT: }
