// Spread, holes, rest, patterns, regular expressions, object literals of every kind, `for..in`, logical assignment, and `this` in arrow functions.
const a = [1, 2, 3]
const b = [0, ...a, 4, ...[5, 6], ..."xy"]
console.log(b.join(","), b.length, [...new Set([1, 1, 2])].join(""), [1, , 3].length, 1 in [1, , 3])
function sum(first: number, ...rest: number[]): number { let t = first; for (const r of rest) t += r; return t }
console.log(sum(1), sum(1, 2), sum(1, 2, 3, 4), sum(...[1, 2, 3] as [number, number, number]), Math.max(...a), Math.max(0, ...a, 9))
const [p, q = 7, ...others] = [1, undefined, 3, 4, 5]
console.log(p, q, others.join("+"))
const { x, y: renamed, z = 9, ...remaining } = { x: 1, y: 2, w: 3, v: 4 } as { x: number, y: number, z?: number, w: number, v: number }
console.log(x, renamed, z, Object.keys(remaining).join(","), remaining.w)
let m = 1, n = 2;
[m, n] = [n, m]
console.log(m, n)
let o1 = 0, o2 = "";
({ o1, k: o2 = "d" } = { o1: 5 } as { o1: number, k?: string })
console.log(o1, o2)
const key = "dyn" + 1
const base = { one: 1, two: 2 }
const made: any = { zero: 0, ...base, [key]: "computed", get three() { return this.one + 2 }, set four(v: number) { this.stored = v }, two: 22, method() { return this.zero } }
made.four = 44
console.log(JSON.stringify(made), made.three, made.stored, made.method(), made.dyn1)
console.log(/a(b+)c/.exec("xabbbc")![1], "a-b-c".replace(/-/g, "+"), /^\d+$/.test("123"), /X/i.flags, "a/b".split(/\//).length)
let keys = ""
for (const k in { a: 1, b: 2, c: 3 }) keys += k
for (const k in [7, 8]) keys += k
const victim: any = { a: 1, b: 2, c: 3 }
for (const k in victim) { keys += k; delete victim.b }
console.log(keys)
let u: number | undefined, v: number | null = 0, w = 5
u ??= 1; u ??= 2; v ||= 3; v ||= 4; w &&= 6
const holder: { c?: number } = {}
holder.c ??= 10; holder.c ||= 11; holder.c &&= 12
console.log(u, v, w, holder.c)
class Counter {
  count = 0
  bump = () => { this.count++ }
  all(list: number[]): number { list.forEach(item => { this.count += item }); return this.count }
  later(): () => () => number { return () => () => this.count }
}
const counter = new Counter()
counter.bump(); counter.bump()
console.log(counter.all([1, 2, 3]), counter.later()()())
const maybe: { f?: () => string, g: { h?: (n: number) => number } } = { g: {} }
console.log(maybe.f?.(), maybe.g.h?.(1), ({ f: () => "called" }).f?.())
const parsed: number[] = JSON.parse("[1,2,3]")
let s = 0
for (let i = 0; i < parsed.length; i++) s += parsed[i]!
console.log(s, new Date(...[2020, 0, 2] as [number, number, number]).getFullYear())
