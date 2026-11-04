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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="count"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inside"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = String string="shadowed"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="eval" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="limit"
// CHECK-NEXT: v10 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v11 = StrictEq v8, v10
// CHECK-NEXT: Branch v11 -> taken b2(v5), notTaken b1(| 0)
// CHECK-NEXT: b1(v12):
// CHECK-NEXT: v13 = Call v12, -, v9 calleeName="eval"
// CHECK-NEXT: Jump -> next b2(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="eval" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="count++"
// CHECK-NEXT: v19 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v20 = StrictEq v17, v19
// CHECK-NEXT: Branch v20 -> taken b3(), notTaken b4(| 0)
// CHECK-NEXT: b3():
// CHECK-NEXT: v21 = DirectEval v18, v0, v1, v5, v4 evalScope=e13
// CHECK-NEXT: Jump -> next b5(v21)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = Call v22, -, v18 calleeName="eval"
// CHECK-NEXT: Jump -> next b5(v23)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = NewClosure v5, v0, v1, v4, v4 function=[[f_2]]
// CHECK-NEXT: v26 = Call v25
// CHECK-NEXT: v27 = NewArray v14, v24, v26 contents=anything
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
