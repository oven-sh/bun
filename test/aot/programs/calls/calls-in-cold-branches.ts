// Functions with a short way through and calls only in arms: what is live across such a call has to be there behind it, whatever it is kept in,
// a collection in the callee has to find it, an exception has to pass, and a stack trace has to name the function.
interface Item { id: number; name: string; weight: number; next: Item | undefined; cached: Item | undefined }
let made = 0
function make(id: number, next: Item | undefined): Item { made++; return { id, name: "item" + id, weight: id / 4, next, cached: undefined } }
function churn(n: number): number { let last: Item | undefined; for (let i = 0; i < n; i++) last = make(i, i & 7 ? last : undefined); return last ? last.id : -1 }
function slow(item: Item): Item { churn(50); return make(item.id + 1000, item) }
function cachedOf(item: Item): Item { return item.cached ?? (item.cached = slow(item)) }
function oneArm(item: Item, a: number, b: number, text: string, ratio: number): string {
  const sum = a + b
  const other = item.id & 1 ? cachedOf(item) : item
  return text + ":" + sum + ":" + other.id + ":" + ratio * 2 + ":" + item.name
}
function threeArms(item: Item, mask: number): number {
  let total = item.id
  const w = item.weight
  if (mask & 1) total += cachedOf(item).id
  if (mask & 2) total += churn(10)
  if (mask & 4) total += slow(item).weight
  return total + w
}
function manyLive(a: Item, b: Item, c: Item, d: number, e: number, f: number, g: string, h: string, take: boolean): string {
  const x = d * 1.5, y = e * 2.5, z = f * 3.5
  const got = take ? slow(a) : a
  return got.id + "," + a.name + b.name + c.name + "," + (x + y + z) + "," + g + h + "," + (d + e + f)
}
function throwsInArm(item: Item, fail: boolean): number {
  const before = item.id * 2
  if (fail) raise(item)
  return before + 1
}
function raise(item: Item): never { churn(5); throw new RangeError("item " + item.id) }
function names(error: Error): string {
  return String(error.stack).split("\n").map(line => /^(?:\s*at )?([A-Za-z]\w*)[ @(]/.exec(line)?.[1]).filter(name => name && name !== "RangeError" && name !== "Error" && name !== "module").slice(0, 4).join(" < ")
}
function outer(item: Item, fail: boolean): number { const kept = item.name.length; return throwsInArm(item, fail) + kept }
function walk(item: Item | undefined, depth: number): number {
  if (!item) return depth
  const here = item.id
  const below = item.id % 3 ? walk(item.next, depth + 1) : walk(item.next, depth + 2) + churn(3)
  return below + here
}
function twice(item: Item, both: boolean): number {
  const first = both ? cachedOf(item) : item
  const second = both ? slow(first) : first
  return first.id + second.id + item.id
}
function inLoop(items: Item[]): number {
  let total = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    total += item.id % 5 ? item.weight : cachedOf(item).weight + i
  }
  return total
}
const items: Item[] = []
for (let i = 0; i < 40; i++) items.push(make(i, items[i - 1]))
const lines: string[] = []
for (let round = 0; round < 300; round++) {
  const item = items[round % items.length]
  lines.push(oneArm(item, round, round * 2, "t" + (round & 3), round / 8))
  lines.push(String(threeArms(item, round & 7)))
  lines.push(manyLive(item, items[(round + 1) % 40], items[(round + 2) % 40], round, round + 1, round + 2, "g" + round, "h", round % 7 === 0))
  lines.push(String(twice(item, round % 4 === 0)))
}
let hash = 0
for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0
console.log(lines.length, hash, lines[7], lines[1196])
console.log(outer(items[3], false))
try { outer(items[4], true) } catch (error) { console.log((error as Error).message, "|", names(error as Error)) }
let caught = 0
for (let i = 0; i < 200; i++) { try { outer(items[i % 40], i % 3 === 0) } catch { caught++ } }
console.log(caught, walk(items[39], 0), inLoop(items), made > 1000)
