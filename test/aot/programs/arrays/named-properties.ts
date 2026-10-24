// Arrays that get a handful of named properties right after they are made, as a syntax tree's node lists do.
interface NodeArray<T> extends Array<T> { pos: number; end: number; hasTrailingComma: boolean; transformFlags: number }
interface Tagged<T> extends Array<T> { owner: object | undefined; label: string }
const host = globalThis as any
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc
function createNodeArray<T>(elements: T[], hasTrailingComma?: boolean): NodeArray<T> {
  const array = (elements.length >= 1 && elements.length <= 4 ? elements.slice() : elements) as NodeArray<T>
  array.pos = -1
  array.end = -1
  array.hasTrailingComma = !!hasTrailingComma
  array.transformFlags = 0
  return array
}
function tag<T>(elements: T[], owner: object | undefined, label: string): Tagged<T> {
  const array = elements as Tagged<T>
  array.owner = owner
  array.label = label
  return array
}
const show = (what: string, array: any[]) => console.log(what, array.length, JSON.stringify(array), Object.keys(array).join(), JSON.stringify(Object.entries(array).filter(([key]) => isNaN(Number(key)))))
show("empty", createNodeArray([]))
show("numbers", createNodeArray([1, 2, 3], true))
show("doubles", createNodeArray([1.5, 2.5]))
show("strings", createNodeArray(["a", "b", "c", "d", "e"]))
show("mixed", createNodeArray([1, "a", null, undefined, {}, [1]]))
show("holes", createNodeArray([1, , 3] as number[]))
show("long", createNodeArray(Array.from({ length: 40 }, (_, i) => i)))
// They are still arrays.
const list = createNodeArray<number>([])
for (let i = 0; i < 100; i++) list.push(i * i)
list.pos = 5; list.end += 10; list.transformFlags |= 6
console.log(list.length, list[99], list.pos, list.end, list.hasTrailingComma, list.transformFlags, Array.isArray(list), list.slice(0, 2).join(), (list.slice(0, 2) as any).pos, list.map(x => x)[3], list.indexOf(81), list.pop(), list.length)
list.length = 2
console.log(JSON.stringify(list), list.pos, Object.keys(list).join())
// Many of them, of every size, kept over collections.
const kept: NodeArray<number | string>[] = []
let sum = 0
for (let i = 0; i < 60000; i++) {
  const elements: (number | string)[] = []
  for (let j = 0; j < i % 9; j++) elements.push(j % 2 ? "s" + j : i + j)
  const array = createNodeArray(elements, i % 2 === 0)
  array.end = i
  sum += array.length + array.pos + array.transformFlags + (array.hasTrailingComma ? 1 : 0)
  if (i % 3000 === 0) kept.push(array)
  if (i % 25000 === 24999) collect()
}
collect()
console.log(sum, kept.map(array => array.length + ":" + array.end + ":" + array.join("")).join(" "))
// Values that are cells, stored into arrays that have grown old.
const old: number[][] = []
for (let i = 0; i < 3000; i++) old.push([i, i + 1, i + 2, i + 3, i + 4])
collect()
const tagged = old.map((elements, i) => tag(elements, i % 3 ? { id: i } : undefined, "label" + i))
collect()
let ids = 0
for (const array of tagged) ids += ((array.owner as { id: number } | undefined)?.id ?? 1) + array.label.length + array[4]
console.log(ids)
// Arrays that are not as they were made.
const frozen = Object.freeze([1, 2])
try { createNodeArray([...frozen, 3, 4, 5].slice(0, 5)); tag(frozen as number[], undefined, "x"); console.log("stored") } catch (error) { console.log((error as Error).constructor.name) }
const already = [1, 2, 3, 4, 5] as NodeArray<number>
already.end = 7
show("already", createNodeArray(already))
const other = [1, 2, 3, 4, 5] as any
other.first = "first"
show("other", createNodeArray(other))
class List<T> extends Array<T> { extra = "own" }
const derived = new List<number>()
derived.push(1, 2, 3, 4, 5)
show("derived", createNodeArray(derived))
console.log(derived instanceof List, (derived as any).pos)
