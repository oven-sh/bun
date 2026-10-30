// Untyped code stores values of the right kind into typed fields, in five ways.
interface Gauge { n: number; s: string; b: boolean; o: { v: number }; f: () => string; opt?: number; list: number[] }
function make(): Gauge { return { n: 1, s: "s", b: true, o: { v: 1 }, f: () => "f", list: [1] } }
function text(x: unknown): string {
  return typeof x + ":" + (typeof x === "object" && x !== null ? JSON.stringify(x) : typeof x === "function" ? "fn" : String(x))
}
function peek(x: any, k: string): string { return text(x[k]) }
function others(g: Gauge, except: string): string {
  const out: string[] = []
  if (except !== "n") out.push(String(g.n + 1))
  if (except !== "s") out.push(g.s + "!")
  if (except !== "b") out.push(String(!g.b))
  if (except !== "o") out.push(String(g.o.v))
  if (except !== "f") out.push(g.f())
  if (except !== "opt") out.push(String(g.opt))
  if (except !== "list") out.push(String(g.list.length))
  return out.join("")
}
function restore(g: Gauge, k: string): void {
  if (k === "n") g.n = 2; else if (k === "s") g.s = "t"; else if (k === "b") g.b = false; else if (k === "o") g.o = { v: 2 }
  else if (k === "f") g.f = () => "g"; else if (k === "opt") g.opt = 3; else if (k === "list") g.list = [1, 2]
}
function put(g: object, k: string, w: unknown, way: number): void {
  const loose: any = g
  if (way % 5 === 0) loose[k] = w
  else if (way % 5 === 1) Reflect.set(g, k, w)
  else if (way % 5 === 2) Object.assign(g, { [k]: w })
  else if (way % 5 === 3) Object.defineProperty(g, k, { value: w, writable: true, enumerable: true, configurable: true })
  else for (const [name, value] of Object.entries({ [k]: w })) loose[name] = value
}
const spare = make()
const right: Record<string, unknown[]> = {
  n: [2.5, -0, NaN, 1e300, -1],
  s: ["", "x".repeat(3), "é", String(5), "a" + "b"],
  b: [false, true, spare.b, !spare.b, spare.n > 2],
  o: [spare.o, make().o, spare.o, make().o, spare.o],
  f: [() => "other", spare.f, String, function () { return "old" }, () => "last"],
  opt: [0, undefined, 7.5, -0, 4294967296],
  list: [[], [1, 2, 3], [0.5], spare.list, new Array<number>(2)],
}
let way = 0
for (const k of Object.keys(right)) {
  const line: string[] = []
  for (const w of right[k]) {
    const g = make()
    put(g, k, w, way++)
    const seen = [peek(g, k), text(Object.getOwnPropertyDescriptor(g, k)?.value), k in g, Object.keys(g).join(""), others(g, k === "f" ? "f" : "")].join()
    restore(g, k)
    line.push(seen + "," + others(g, "") + "," + Object.keys(g).join(""))
  }
  console.log(k, line.join(" "))
}
// null and undefined where the field holds a reference: typed code finds them.
for (const k of ["s", "o", "f", "list"]) {
  const line: string[] = []
  for (const w of [null, undefined]) {
    const g = make()
    put(g, k, w, way++)
    line.push([peek(g, k), k in g, Object.keys(g).join(""), others(g, k), String(g.s), g.o == null, g.f == null, g.list == null].join())
  }
  console.log(k, line.join(" "))
}
// Reflection and copies carry the values as they are.
const odd = make()
put(odd, "n", 9.5, 0); put(odd, "b", false, 1); put(odd, "opt", -0, 2)
const copyOfOdd: any = { ...(odd as any) }
console.log(JSON.stringify(odd), Object.values(odd).map(text).join(), Object.entries(odd).map(e => e[0] + "=" + text(e[1])).join("&"))
console.log(JSON.stringify(copyOfOdd), (odd as any).n === 9.5, (odd as any).n + 1, odd.s + odd.o.v + odd.f() + odd.list.join(), Object.is(odd.opt, -0))
// Its neighbours of the same layout are not touched.
const neighbour = make()
console.log(others(neighbour, ""), neighbour.n + 1, !neighbour.b, String(neighbour.opt))
// The right kind in another storage class than typed code ever stores.
interface Small { count: number; on: boolean }
const smalls: Small[] = []
for (let i = 0; i < 8; i++) smalls.push({ count: i, on: i % 2 === 0 })
const unusual = [2.5, NaN, -0, 1e300, 2147483648, -2147483649, Infinity, 4294967296.5]
unusual.forEach((x, i) => put(smalls[i], "count", x, i))
console.log(smalls.map(c => Object.is(c.count, -0) ? "-0" : String(c.count)).join(), smalls.map(c => c.count + 1).join(), smalls.map(c => c.count | 0).join(), smalls.map(c => c.on).join(""))
// A class.
class Ticker { n = 0; label = "t"; inc(): number { return ++this.n } tag(): string { return this.label + "#" } }
const ticker = new Ticker()
console.log(ticker.inc(), ticker.inc())
put(ticker, "n", 5, 1)
console.log(ticker.inc(), ticker.n, JSON.stringify(ticker), peek(ticker, "n"), ticker.tag(), new Ticker().inc())
// A loop that reads one field through the type while untyped code has stored to other fields of some receivers.
const row: Gauge[] = []
for (let i = 0; i < 20; i++) { const g = make(); g.n = i; if (i % 3 === 0) put(g, "s", "i" + i, i); if (i % 4 === 0) put(g, "b", false, i); row.push(g) }
let sum = 0
for (let round = 0; round < 20; round++) for (const g of row) { sum += g.n + g.o.v + g.list.length + g.s.length + (g.b ? 1 : 0); g.n += 1 }
console.log(sum, row.map(g => peek(g, "s")[7] + peek(g, "b")[8]).join(""))
