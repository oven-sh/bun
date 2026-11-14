// RUN: lower
// OPTIONS: builtin-modules

// TypeScript rejects these uses of `super` and `arguments`, JavaScript does not: below a `@ts-ignore` they build and run. Plain Bun refuses the last one, `arguments` in the parameters of a function that a field initializer creates, which the language allows: the output is stored.
class Base { name = "base"; }
class NoBase { describe() {
  // @ts-ignore
  return typeof super.toString;
} }
class InArrow extends Base {
  // @ts-ignore
  constructor() {
    // @ts-ignore
    const initialize = () => super();
    initialize();
  }
}
class InParameter extends Base {
  // @ts-ignore
  constructor(self = super()) {
    console.log(typeof self);
  }
}
class InNestedParameter {
  // @ts-ignore
  make = function (first = arguments.length) { return first; };
}
console.log(new NoBase().describe(), new InArrow().name, new InParameter().name, new InNestedParameter().make());

// GENERATED: Base describe InArrow initialize make
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="toString"
// CHECK-NEXT: v4 = TypeOf v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="InArrow"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = NewObject layout=[[L_7]]
// CHECK-NEXT: v4 = CallDirect v3, v1, v0 function=[[f_8]]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = GetEnvironmentField v3 layout=[[L_7]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="initialize"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_7]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_7]], v1: anything, v2: function):
// CHECK-NEXT: v3 = GetSuperBase v2
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_7]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasArgumentCount, IsChecked] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: anything):
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(v0), notTaken b1(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Jump -> next b2(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
