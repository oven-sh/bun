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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_5]]} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="toString"
// CHECK-NEXT: v4 = TypeOf v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="InArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = NewObject layout=[[L_9]]
// CHECK-NEXT: v4 = NewClosure v3, v1, v0 function=[[f_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Call v5
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b7(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined
// CHECK-NEXT: Branch v11 -> taken b4(| 0), notTaken b8(| 0)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = GetEnvironmentField v3 layout=[[L_9]]
// CHECK-NEXT: v14 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v14 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v15) frequency=Unlikely:
// CHECK-NEXT: v16 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v16
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: Jump -> next b7(v17)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: b8(v19) frequency=Unlikely:
// CHECK-NEXT: v20 = NewRuntimeError runtimeError=DerivedConstructorResult name="InArrow"
// CHECK-NEXT: Throw v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="initialize"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=anything}, {type=function flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v2
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3(v10) frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasArgumentCount, HasHiddenRest, IsChecked] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: int[0, 4294967295], v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v0, v2, v1
// CHECK-NEXT: v4 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = PropGet v3 key="length"
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
