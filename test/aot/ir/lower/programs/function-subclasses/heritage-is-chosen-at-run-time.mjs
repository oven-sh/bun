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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]] flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[f_6]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]|[[f_2]]|[[f_3]]|[[f_4]]|[[f_5]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewDictionary
// CHECK-NEXT: v3 = ToPropertyKey v1
// CHECK-NEXT: v4 = ResolveHeritage v0
// CHECK-NEXT: v5 = NewClosure v1 function=[[f_7]]
// CHECK-NEXT: SetFunctionName v5, v3
// CHECK-NEXT: v7 = NewClass v5, v0, v4 layout=[[L_8]]
// CHECK-NEXT: v8 = FinishClass v7 layout=[[L_8]]
// CHECK-NEXT: ElemDefine v2, v3, v8
// CHECK-NEXT: v10 = ElemGet v2, v1
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] thisType={type=[[L_9]] flags=[IsExpected]} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: PropSet v1, v2 key="own"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Either"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="flag"
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v15 key="side"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b10(v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10(v26)
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b11(v28) frequency=Unlikely:
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="Either"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b12(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
