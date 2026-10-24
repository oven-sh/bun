// Every declared object type can hold objects that untyped code created: they arrive by a cast, an annotation, an argument, a result, a name, an await, a clone and inside a union, beside objects of other types that the program makes itself.
interface Inner { deep: number }
interface Element { id: number }
interface ByCast { inner: Inner; list: Element[]; name: string }
interface ByAnnotation { a: number }
interface ByArgument { b: number }
interface ByReturn { c: number }
interface ByName { d: number }
interface ByAwait { e: number }
interface ByClone { f: number }
interface InUnion { g: number }
interface OwnInner { deep: number }
interface Own { inner: OwnInner; name: string }
interface Sibling { inner: OwnInner; list: number[]; name: string }
interface NotADoor { h: number }
interface Shadowed { i: number }
class Made { constructor(public m: number) {} twice() { return this.m * 2 } }
const text = (value: unknown) => JSON.stringify(value)
const byCast = JSON.parse(text({ inner: { deep: 1 }, list: [{ id: 2 }], name: "n" })) as ByCast
const byAnnotation: ByAnnotation = JSON.parse(text({ a: 3 }))
const takesGiven = (x: ByArgument) => x.b + 1
function byReturn(): ByReturn { return JSON.parse(text({ c: 5 })) }
const raw = JSON.parse(text({ d: 6, nested: { g: 9 } }))
const byName = raw as ByName
const inUnion = raw.nested as InUnion | undefined
const response = { json: () => Promise.resolve({ e: 7 }) } as unknown as Response
const byAwait = (await response.json()) as ByAwait
const byClone = structuredClone({ f: 8 } as unknown) as ByClone
const own: Own = { inner: { deep: 10 }, name: "own" }
const sibling: Sibling = { inner: { deep: 11 }, list: [1], name: "sibling" }
const takesOwn = (x: Own) => x.inner.deep + x.name.length
const parser = { parse: (s: string): any => ({ h: s.length }) }
const notADoor = parser.parse("abc") as NotADoor
function shadowed(): Shadowed { const JSON = { parse: (s: string): any => ({ i: s.length }) }; return JSON.parse("abcd") as Shadowed }
const made = new Made(12)
console.log(byCast.inner.deep, byCast.list[0].id, byCast.name, byAnnotation.a, takesGiven(JSON.parse(text({ b: 4 }))), byReturn().c, byName.d, inUnion?.g, byAwait.e, byClone.f)
console.log(takesOwn(own), sibling.inner.deep + sibling.list.length, notADoor.h, shadowed().i, made.twice())
console.log(text(byCast), text(own), Object.keys(byCast).join(), Object.keys(own).join())
export {}
