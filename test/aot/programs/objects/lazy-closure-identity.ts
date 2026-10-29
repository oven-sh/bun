// A closure stored in a field at creation may be created only at its first read as a value. It is still one function per object with one identity: across calls, reads by name, copies, built-ins, a freeze, collections and the conversion to an ordinary object.
// COUNTER: DeleteOfRequiredField = 1
// COUNTER: RedefinedProperty = 1
// COUNTER: UseAsPrototype = 1
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true))
class Plain { label: string = "p"; hits: number = 0; onClick = () => this.label + ++this.hits; zero = () => 0 }
class Listed { label: string = "l"; hits: number = 0; onClick = () => this.label + ++this.hits; zero = () => 0 }
class Lost { label: string = "x"; hits: number = 0; onClick = () => this.label + ++this.hits; zero = () => 0 }
class Derived extends Plain { more = () => this.label + "!" }
class Replaced { label: string = "r"; onClick = () => this.label }
class OnlyCalled { n: number = 1; step = () => ++this.n }
function makeLiteral(n: number) { return { n, twice() { return this.n * 2 }, zero: () => 0 } }

const a = new Plain(), b = new Plain(), c = new Plain(), d = new Plain(), e = new Plain(), s = new Derived()
console.log(a.onClick(), a.onClick === a.onClick, a.onClick !== b.onClick, a.zero === a.zero, a.zero !== b.zero)
const { onClick } = b
console.log(onClick(), onClick === b.onClick, onClick.call(a), b.hits, a.hits)
const copy = { ...c }
console.log(copy.onClick === c.onClick, copy.zero === c.zero)
copy.label = "copy"
console.log(copy.onClick(), c.hits, copy.hits)
console.log((d as any)[["on", "Click"].join("")] === d.onClick, (d as any).onClick === d.onClick)
;(d.onClick as any).tag = "t"
console.log((d.onClick as any).tag, (new Plain().onClick as any).tag, d.onClick.name, d.onClick.length)
const map = new Map<unknown, number>(), listeners: unknown[] = []
map.set(d.zero, 1); listeners.push(d.onClick)
console.log(map.get(d.zero), listeners.indexOf(d.onClick), new Set([d.zero, d.zero, new Plain().zero]).size)
console.log(s.more === s.more, s.onClick === s.onClick, s.more())

const saved = e.onClick
collect()
console.log(saved === e.onClick)
const retained: Plain[] = []
for (let i = 0; i < 20000; i++) {
  const k = new Plain()
  if (i % 100 === 0) retained.push(k)
  if (i % 200 === 0) (k.onClick as any).tag = i
}
collect()
console.log(retained.filter(k => k.onClick === k.onClick && k.onClick() === "p1").length, retained.filter((k, i) => (k.onClick as any).tag === (i & 1 ? undefined : i * 100)).length)

const checks: ((l: Listed) => unknown)[] = [
  l => Object.values(l).includes(l.onClick),
  l => Object.entries(l).find(entry => entry[0] === "zero")![1] === l.zero,
  l => { const descriptor = Object.getOwnPropertyDescriptor(l, "onClick")!; return [descriptor.value === l.onClick, descriptor.writable, descriptor.enumerable, descriptor.configurable].join() },
  l => JSON.stringify(l),
  l => Object.keys(l).join(),
  l => Object.assign({}, l).onClick === l.onClick,
  l => Object.assign(new Listed(), l).onClick === l.onClick,
]
console.log(checks.map(check => check(new Listed())).join(" "))
const f = Object.freeze(new Listed())
console.log(f.zero === f.zero, f.onClick === f.onClick, f.zero(), said(() => f.onClick()))

const g = new Lost(), h = new Lost(), parent = new Lost()
delete (g as any).label
console.log(g.onClick === g.onClick, g.onClick())
g.label = "again"
console.log(g.onClick())
const before = h.onClick
Object.defineProperty(h, "label", { get: () => "got" })
console.log(h.onClick === before, before())
const child = Object.create(parent)
console.log(child.onClick === parent.onClick, child.onClick(), parent.hits)

const r = new Replaced(), first = r.onClick
r.onClick = () => "other"
console.log(r.onClick(), r.onClick !== first, first(), new Replaced().onClick())
const o = new OnlyCalled(), forInKeys: string[] = []
console.log(o.step(), o.step())
for (const key in o) forInKeys.push(key)
console.log(Object.keys(o).join(), "step" in o, Object.hasOwn(o, "step"), forInKeys.join(), Reflect.ownKeys(o).length, JSON.stringify(o))
const m = makeLiteral(2), n = makeLiteral(3)
console.log(m.twice === m.twice, m.twice !== n.twice, m.zero !== n.zero, m.twice(), m.twice.call({ n: 5 }), ({ ...m }).twice === m.twice)
export {}
