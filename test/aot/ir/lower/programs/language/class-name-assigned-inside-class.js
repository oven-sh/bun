// RUN: lower
// OPTIONS: builtin-modules

// Within a class its name is a constant: an assignment evaluates its right side and throws a TypeError.
const log = [];
function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name, error.message, log.splice(0).join());
  }
}
const value = () => (log.push("the right side"), 42);
tell("a constructor", () => { class C { constructor() { C = value(); } } return new C(); });
tell("a constructor of an expression", () => new (class C { constructor() { C = value(); } })());
tell("a method", () => { class C { m() { C = value(); } } return new C().m(); });
tell("a method of an expression", () => new (class C { m() { C = value(); } })().m());
tell("a getter", () => { class C { get x() { C = value(); return 1; } } return new C().x; });
tell("a setter", () => { class C { set x(_) { C = value(); } } return (new C().x = 15); });
tell("a static method", () => { class C { static m() { C = value(); } } return C.m(); });
tell("a field", () => { class C { f = (C = value()); } return new C().f; });
tell("a static block", () => { class C { static { C = value(); } } return C; });
tell("an arrow function in a method", () => { class C { m() { return () => { C = value(); }; } } return new C().m()(); });
tell("+=", () => { class C { m() { C += value(); } } return new C().m(); });
tell("++", () => { class C { m() { C++; } } return new C().m(); });
tell("a pattern", () => { class C { m() { [C] = [value()]; } } return new C().m(); });
tell("another class's name", () => { let D = class {}; class C { m() { D = value(); return D; } } return new C().m(); });
tell("a parameter of that name", () => { class C { m(C) { C = value(); return C; } } return new C().m(); });
class AtTheTop { m() { AtTheTop = value(); } }
tell("at the top level", () => new AtTheTop().m());

// GENERATED: tell value x D
// CHECK-LABEL: function {{*}}name="tell"
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
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v9 key="constructor"
// CHECK-NEXT: v16 = PropGet v15 key="name"
// CHECK-NEXT: v17 = PropGet v9 key="message"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="log"
// CHECK-NEXT: v20 = PropGet v19 key="splice"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="splice" calleeName="log.splice"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v14, v12, v0, v16, v17, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="the right side"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Integer integer=42
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="C"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="value"
// CHECK-NEXT: v5 = Call v4 calleeName="value"
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=ConstantAssignment name="C"
// CHECK-NEXT: Throw v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_8]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="C"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="value"
// CHECK-NEXT: v6 = Call v5 calleeName="value"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = NewRuntimeError runtimeError=ConstantAssignment name="C"
// CHECK-NEXT: Throw v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
