// RUN: lower
// OPTIONS: builtin-modules

// A declaration that begins with `export` is a variable of the module like any other: a direct eval reads it and stores to it.
export const limit = 5
export function double(n) {
  return n * 2
}
export class Box {}
export let count = 0
export var old = "old"
export default function named() {
  return 1
}
export function read() {
  return count
}
const listed = "listed"
export { listed }
console.log(eval("typeof limit"), eval("typeof double"), eval("typeof Box"), eval("typeof count"), eval("typeof old"), eval("typeof named"), eval("typeof listed"))
console.log(eval("limit"), eval("double(limit)"), eval("new Box() instanceof Box"), eval("named()"))
eval("count = 5")
eval("old += '!'")
console.log(read(), count, old)
try {
  eval("limit = 6")
} catch (error) {
  console.log(error.name, limit)
}
function inside() {
  const limit = "shadowed"
  return [eval("limit"), eval("count++"), (() => eval("double(count)"))()]
}
console.log(inside().join(), count)

// GENERATED: double read inside Box
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="count"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inside"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = String string="shadowed"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|"shadowed" flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="eval" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="limit"
// CHECK-NEXT: v11 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v12 = StrictEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: v14 = Call v13, -, v10 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="eval" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="count++"
// CHECK-NEXT: v20 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v21 = StrictEq v18, v20
// CHECK-NEXT: Branch v21 -> taken b5(), notTaken b6(| 0)
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = DirectEval v19, v0, v1, v6, v4 evalScope=e13
// CHECK-NEXT: Jump -> next b7(v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = Call v23, -, v19 calleeName="eval"
// CHECK-NEXT: Jump -> next b7(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = NewClosure v6, v0, v1, v4, v4 function=[[f_4]]
// CHECK-NEXT: v27 = Call v26
// CHECK-NEXT: v28 = NewArray v15, v25, v27 contents=anything
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
