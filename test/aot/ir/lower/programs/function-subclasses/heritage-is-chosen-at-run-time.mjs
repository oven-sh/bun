// RUN: lower
// OPTIONS: builtin-modules

// Which function of the library a class extends is known only when the class is made.
import { Readable, Writable, Duplex } from "node:stream";
import { EventEmitter } from "node:events";
function below(Base, name) {
  return { [name]: class extends Base { constructor(options) { super(options); this.mark = name; } } }[name];
}
const bases = [Readable, Writable, Duplex, EventEmitter, Object, function Own() { this.own = 1; }];
for (const Base of bases) {
  const Made = below(Base, "Below" + Base.name);
  const made = new Made();
  console.log(Made.name, made.mark, made instanceof Base, made instanceof EventEmitter, Object.keys(made).includes("mark"), made.own);
}
const flag = process.argv.length > 100;
class Either extends (flag ? Readable : Writable) { constructor() { super(); this.side = flag; } }
const either = new Either();
console.log(either instanceof Writable, either instanceof Readable, either.side, typeof either.write, typeof either.read);
let Chosen = Readable;
Chosen = Writable;
class Late extends Chosen {}
console.log(new Late() instanceof Writable, new Late() instanceof Readable);

// GENERATED: below Own Either Late
// CHECK-LABEL: function {{*}}name="below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]] flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]], v1: undefined|null|string):
// CHECK-NEXT: v2 = ToPropertyKey v1
// CHECK-NEXT: v3 = ResolveHeritage v0
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_6]]
// CHECK-NEXT: SetFunctionName v4, v2
// CHECK-NEXT: v6 = NewClass v4, v0, v3 layout=[[L_7]]
// CHECK-NEXT: v7 = FinishClass v6 layout=[[L_7]]
// CHECK-NEXT: v8 = NewObject layout=[[L_8]]
// CHECK-NEXT: ElemDefine v8, v2, v7
// CHECK-NEXT: v10 = FinishObject v8
// CHECK-NEXT: v11 = ElemGet v10, v1
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] thisType={type=[[L_9]] flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: PropSet v0, v1 key="own"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Either"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_10]]}
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="flag"
// CHECK-NEXT: PropSet v11, v13 key="side"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Jump -> next b9(v17)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = TypeTest v18 testedType=undefined
// CHECK-NEXT: Branch v19 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b8(v24):
// CHECK-NEXT: Jump -> next b9(v24)
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=DerivedConstructorResult name="Either"
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b11(v28):
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_12]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
