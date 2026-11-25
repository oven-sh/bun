// Int32Array . read-and-store-back . the-length-behind . a-call-in-front: one shape of make-views-in-loops.py: every kind of arrival goes through one function.
let deedAt = -1
let deedOf: () => void = () => {}
function each(i: number): void { if (i === deedAt) deedOf() }
function run(view: Int32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { each(i); view[i] = view[i]! * view.length; sum = (sum + view[i]!) | 0 } return sum }
;(globalThis as any).kit = { run }
const kit = (globalThis as any).kit
const Kind = Int32Array
const filled = (view: any) => { for (let i = 0; i < view.length; i++) view[i] = i + 1; return view }
class Own extends Kind {}
const size = Kind.BYTES_PER_ELEMENT
const arrivals: [string, () => any, (() => void)?][] = [
  ["as made", () => filled(new Kind(4))],
  ["short", () => filled(new Kind(2))],
  ["empty", () => new Kind(0)],
  ["long", () => filled(new Kind(9))],
  ["subclass", () => filled(new Own(4))],
  ["own length", () => Object.defineProperty(filled(new Kind(4)), "length", { value: 3 })],
  ["relinked", () => Object.setPrototypeOf(filled(new Kind(4)), Object.create(Kind.prototype, { length: { value: 5 } }))],
  ["at an offset", () => filled(new Kind(new ArrayBuffer(size * 8), size * 2, 4))],
  ["shared", () => filled(new Kind(new SharedArrayBuffer(size * 4)))],
  ["shared, can grow", () => filled(new Kind(new SharedArrayBuffer(size * 4, { maxByteLength: size * 16 })))],
  ["buffer", () => Kind === (Uint8Array as any) ? Buffer.from([1, 2, 3, 4]) : filled(new Kind(4))],
  ["data view", () => new DataView(new ArrayBuffer(8))],
  ["list", () => [1, 2, 3, 4]],
  ["frozen list", () => Object.freeze([1, 2, 3, 4])],
  ["text", () => "1234"],
  ["object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["null", () => null],
]
const show = (view: any) => { try { return view === null ? "null" : typeof view === "string" ? view : view instanceof DataView ? "view " + Object.keys(view).join() : Array.from(view as ArrayLike<number>).join() } catch (e) { return (e as Error).constructor.name } }
for (let round = 0; round < 2; round++) for (const [name, make] of arrivals) for (const n of [0, 3, 4, 6]) {
  const view = make()
  deedAt = -1
  let said: string
  try { said = String(kit.run(view, n)) } catch (e) { said = (e as Error).constructor.name }
  console.log(name, n, said, show(view))
}
for (const [name, deed] of [["shrinks", (b: ArrayBuffer) => b.resize(size * 2)], ["grows", (b: ArrayBuffer) => b.resize(size * 8)], ["goes", (b: ArrayBuffer) => { structuredClone(b, { transfer: [b] }) }]] as [string, (b: ArrayBuffer) => void][]) for (const at of [0, 1, 3]) {
  const buffer = new ArrayBuffer(size * 4, { maxByteLength: size * 16 })
  const view = filled(new Kind(buffer))
  deedAt = at
  deedOf = () => deed(buffer)
  let said: string
  try { said = String(kit.run(view, 6)) } catch (e) { said = (e as Error).constructor.name }
  console.log(name, at, said, show(view))
}
