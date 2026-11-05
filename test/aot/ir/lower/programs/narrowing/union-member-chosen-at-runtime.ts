// RUN: lower
// OPTIONS: builtin-modules

// Which member of a union an object literal belongs to depends on a run-time value.
interface Tree { kind: number }
type Result =
  | { type: Tree; fallback: undefined }
  | { type: undefined; fallback: true }
  | { type: undefined; fallback: false }
function result(type: Tree | undefined): Result
function result(type: undefined, fallback: boolean): Result
function result(type: Tree | undefined, fallback: boolean = true) {
  return { type, fallback: type ? undefined : fallback } as Result
}
const no: Result = result(undefined, false)
const yes: Result = result(undefined, true)
const tree: Result = result({ kind: 7 })
for (const r of [no, yes, tree]) console.log(r.type ? r.type.kind : "none", r.fallback, Object.keys(r).join())
export {}

// GENERATED: result
// CHECK-LABEL: function {{*}}name="result"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull]}, {type=undefined|boolean site=[[w_3]]}] results=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|[[L_1]]}
// CHECK-NEXT: v9 = ToBoolean v0
// CHECK-NEXT: Branch v9 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b10(v11)
// CHECK-NEXT: b8(v12):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b10(v7)
// CHECK-NEXT: b10(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|boolean}
// CHECK-NEXT: v15 = NewObject -, v8, v14 layout=[[L_4]] fields=[1, 0]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_4]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
