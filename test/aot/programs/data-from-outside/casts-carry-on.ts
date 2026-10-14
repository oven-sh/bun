// Parsed JSON goes through several casts and stays the same object.
interface Base { id: string }
interface Derived extends Base { extra: number; inner: { n: number } }
const parsed = JSON.parse('{"id":"a"}') as Base
const made = { id: "m", extra: 1, inner: { n: 2 } } as Base
function asDerived(b: Base): Derived { return b as Derived }
const d = asDerived(made)
console.log("a downcast from a tainted type |", d.extra, d.inner.n, d === made, asDerived(parsed).extra)
interface Other { id: string; tag?: string; more: { m: number } }
const o = made as unknown as Other
const keptO: Other = o
console.log("through unknown |", keptO.tag, keptO.more, keptO.id)
interface Listed { rows: { k: string }[]; count: number }
const loose: any = JSON.parse('{"rows":[{"k":"x"}]}')
const listed: Listed = loose
function countOf(l: Listed): string { return l.rows.map(r => r.k).join() + l.count }
console.log("a name that holds what was parsed, in an annotated variable |", countOf(listed), listed === loose)
interface Own { ownNumber: number; ownText: string }
const own: Own = { ownNumber: 1, ownText: "t" }
const again = (own as any) as Own
console.log("the program's own through any |", again.ownNumber, again === own)
