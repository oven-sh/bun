// RUN: lower
// OPTIONS: builtin-modules

// Reduce calls reflect construct for a subclass.
let leaked;
class A { constructor(p) { leaked = this; this.x = p; this.r = this.m(); } m() { return "A.m"; } }
class B extends A { s = 5; m() { return "B.m"; } }
function report(label) { console.log(label, leaked.r, leaked instanceof B, leaked.s, Object.keys(leaked).join(), Object.getPrototypeOf(leaked) === B.prototype, leaked.m()); }
const o = [[1], B].reduce(Reflect.construct.bind(null, A));
console.log(o === leaked, o.r, o.s); report("reduce");

// GENERATED: report A B
// CHECK-LABEL: function {{*}}name="report"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="leaked"
// CHECK-NEXT: v8 = PropGet v7 key="r"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="leaked"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="B"
// CHECK-NEXT: v13 = InstanceOf v10, v12
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="leaked"
// CHECK-NEXT: v16 = PropGet v15 key="s"
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="leaked"
// CHECK-NEXT: v21 = Call v18, v17, v20 calleeName="Object.keys"
// CHECK-NEXT: v22 = PropGet v21 key="join"
// CHECK-NEXT: v23 = Call v22, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: v24 = Builtin builtin=Object
// CHECK-NEXT: v25 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="leaked"
// CHECK-NEXT: v28 = Call v25, v24, v27 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="B"
// CHECK-NEXT: v31 = PropGet v30 key="prototype"
// CHECK-NEXT: v32 = StrictEq v28, v31
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="leaked"
// CHECK-NEXT: v35 = PropGet v34 key="m"
// CHECK-NEXT: v36 = Call v35, v34 calleeKey="m" calleeName="leaked.m"
// CHECK-NEXT: v37 = Call v5, v3, v0, v8, v13, v16, v23, v32, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="leaked"
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|[[L_4]]|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_1]]
// CHECK-NEXT: PropSet v4, v1 key="x"
// CHECK-NEXT: v10 = PropGet v4 key="m"
// CHECK-NEXT: v11 = Call v10, v4 calleeKey="m" calleeName="this.m"
// CHECK-NEXT: PropSet v4, v11 key="r"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v14 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v15):
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
