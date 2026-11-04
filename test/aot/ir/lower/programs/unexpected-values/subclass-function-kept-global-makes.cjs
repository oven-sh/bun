// RUN: lower
// OPTIONS: builtin-modules

// A subclass of function kept in a global makes a function.
Maker = class extends Function {};
const addOne = new Maker("x", "return x + 1");
console.log(addOne(1));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="Function" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v6 = ResolveHeritage v5
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: v8 = NewClass v7, v5, v6 layout=[[L_4]]
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_5]]
// CHECK-NEXT: v10 = FinishClass v8 layout=[[L_4]]
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: PropSet v11, v10 key="Maker" mode=Sloppy [isFreeName]
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="Maker" [isFreeName]
// CHECK-NEXT: v15 = String string="x"
// CHECK-NEXT: v16 = String string="return x + 1"
// CHECK-NEXT: v17 = Construct v14, -, v15, v16 calleeName="Maker"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = Integer integer=1
// CHECK-NEXT: v24 = Call v17, -, v23 calleeName="addOne"
// CHECK-NEXT: v25 = Call v22, v20, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Maker"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
