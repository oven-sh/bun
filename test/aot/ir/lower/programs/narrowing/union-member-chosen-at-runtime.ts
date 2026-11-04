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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull]}, {type=undefined|boolean}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|boolean):
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean}
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|[[L_1]]}
// CHECK-NEXT: v9 = ToBoolean v0
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b5(v7)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|boolean}
// CHECK-NEXT: v14 = NewObject -, v8, v13 layout=[[L_2]] fields=[1, 0]
// CHECK-NEXT: v15 = FinishObject v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
