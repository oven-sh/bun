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
