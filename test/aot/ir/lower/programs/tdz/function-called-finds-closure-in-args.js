// RUN: lower
// OPTIONS: builtin-modules

// A function that is called once finds the closure in arguments.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
let r;
try { r = (function () { return arguments[0](); })(() => later.x); } catch (e) { r = "threw " + e.constructor.name; }
console.log(r);
const later = { x: 1 };
console.log(later.x);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = NewClosure function=[[f_3]]
// CHECK-NEXT: v6 = Call v4, -, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = PropGet v8 key="constructor"
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, v17, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Data data=[[d_4]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v22 variable=[[g_6]]
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v22 key="x"
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v28, v26, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = CreateUnmappedArguments v0, v1
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v2 calleeName="arguments[0]"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="later"
// CHECK-NEXT: v2 = PropGet v1 key="x"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
