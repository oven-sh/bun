// Calls whose callee is not known statically: compiled functions of every kind, and values that are not functions.
class K { v = 1; constructor(public w = 2) {} m(a?: number, b?: number) { return [this?.v, a, b].join() } static s(x: number) { return x + 1 } }
function plain(a: unknown, b: unknown, c: unknown) { return [a, b, c].join("|") }
function rest(...all: unknown[]) { return all.length + ":" + all.join() }
function args() { return arguments.length }
function usesThis(this: unknown, a: number) { return typeof this + a }
function withProps(a: number) { return a * 2 }
;(withProps as any).extra = 5
const arrow = (a = 7, b?: number) => a + "/" + b
async function later(a: number) { return a + 1 }
function* gen(a: number) { yield a; yield a + 1 }
const bound = plain.bind(null, "B")
const table: any[] = [plain, rest, args, usesThis, withProps, arrow, bound, K.s, new K().m, Math.max, String, (x: any) => x, parseInt]
// Without an argument these get `undefined` for a `number`: type-rules/typed-functions-via-any-missing-arguments.
const needAnArgument = new Set<unknown>([usesThis, withProps, K.s])
function callAll(fs: any[]) {
  const out: string[] = []
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]
    out.push(needAnArgument.has(f) ? "-" : String(f()), String(f(1)), String(f(1, 2)), String(f(1, 2, 3)), String(f(1, 2, 3, 4, 5, 6, 7, 8, 9)))
  }
  return out.join(" ; ")
}
console.log(callAll(table))
const holder: any = { f: usesThis, g: new K().m, v: 9 }
console.log(holder.f(1), (0, holder.f)(2))
for (const bad of [K, undefined, null, 1, "s", {}, Symbol.iterator] as any[]) {
  try { console.log(bad(1)) } catch (e) { console.log((e as Error).constructor.name) }
}
const unknown: any[] = [later, gen]
unknown[0](1).then((v: number) => console.log("later", v))
console.log([...unknown[1](5)].join(), (withProps as any).extra, table[4](4))
