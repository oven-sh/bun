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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v13 = InstanceOf v10, v12 writtenExpression="leaked instanceof B"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="leaked"
// CHECK-NEXT: v16 = PropGet v15 key="s"
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="leaked"
// CHECK-NEXT: v21 = Call v18, v17, v20 calleeName="Object.keys"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="join"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v24, v22 calleeKey="join" calleeName="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=Object
// CHECK-NEXT: v28 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="leaked"
// CHECK-NEXT: v31 = Call v28, v27, v30 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="B"
// CHECK-NEXT: v34 = PropGet v33 key="prototype"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v36 = StrictEq v31, v35
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="leaked"
// CHECK-NEXT: v39 = PropGet v38 key="m"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v38 calleeKey="m" calleeName="leaked.m"
// CHECK-NEXT: v42 = Call v5, v3, v0, v8, v13, v16, v26, v36, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="leaked"
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_6]]|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_1]]
// CHECK-NEXT: v10 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v10, v1 key="x"
// CHECK-NEXT: v12 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v4 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="m"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13 calleeKey="m" calleeName="this.m"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v17 key="r"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v21):
// CHECK-NEXT: Jump -> next b4(v21)
// CHECK-NEXT: b3(v22):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_10]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
