// `x!` on a value that is present returns the value, also for 0, "", false and NaN.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
function maybe(flag: boolean): number | undefined { return flag ? 1 : undefined }
function orNull(flag: boolean): string | null { return flag ? "s" : null }
attempt("a2", () => maybe(true)! + 1)
attempt("a4", () => orNull(true)! + "x")
const list = [10, 20]
const holes: (number | undefined)[] = [1, , 3]
attempt("b2", () => list[1]! + 1)
attempt("b5", () => holes[2]!)
attempt("b8", () => "abc"[2]!)
interface Opt { v?: number; child?: Opt | null }
const empty: Opt = {}
const full: Opt = { v: 0, child: { v: 2 } }
attempt("c2", () => full.v! + 1)
attempt("c3", () => empty.child!.v)
attempt("c4", () => full.child!.v!)
const table = new Map<string, number>([["a", 0]])
attempt("d1", () => table.get("a")!)
function falsy(i: number): number | string | boolean | null | undefined { return [0, "", false, NaN, null, undefined][i] }
for (let i = 0; i < 4; i++) attempt("e" + i, () => "<" + falsy(i)! + ">")
const people = [{ id: 1 }, { id: 2 }]
attempt("f1", () => people.find(p => p.id === 2)!.id)
attempt("f2", () => people.find(p => p.id === 3)!.id)
class Late { value?: number; read() { return this.value! + 1 } }
attempt("g2", () => { const l = new Late(); l.value = 1; return l.read() })
function twice(n?: number) { return n! * 2 }
attempt("h2", () => twice(2))
