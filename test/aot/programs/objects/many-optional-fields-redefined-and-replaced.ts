// Objects with many fields, most of which start as undefined and are seldom filled, so that they need not lie in the object itself. Such fields are redefined as accessors, made
// hidden or read-only, given values of another kind, deleted and created again; the listing of the keys, the copies and the typed reads follow.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Wide {
  id: number
  a0: number | undefined = undefined; a1: number | undefined = undefined; a2: number | undefined = undefined; a3: number | undefined = undefined; a4: number | undefined = undefined
  a5: string | undefined = undefined; a6: string | undefined = undefined; a7: string | undefined = undefined; a8: string | undefined = undefined; a9: string | undefined = undefined
  b0: Wide | undefined = undefined; b1: Wide | undefined = undefined; b2: Wide | undefined = undefined; b3: Wide | undefined = undefined; b4: Wide | undefined = undefined
  b5: boolean | undefined = undefined; b6: boolean | undefined = undefined; b7: boolean | undefined = undefined; b8: boolean | undefined = undefined; b9: boolean | undefined = undefined
  c0: unknown = undefined; c1: unknown = undefined; c2: unknown = undefined; c3: unknown = undefined; c4: unknown = undefined
  c5: number[] | undefined = undefined; c6: number[] | undefined = undefined; c7: number[] | undefined = undefined; c8: number[] | undefined = undefined; c9: number[] | undefined = undefined
  d0: number | undefined = undefined; d1: number | undefined = undefined; d2: number | undefined = undefined; d3: number | undefined = undefined; d4: number | undefined = undefined
  d5: string | undefined = undefined; d6: string | undefined = undefined; d7: string | undefined = undefined; d8: string | undefined = undefined; d9: string | undefined = undefined
  last = "last"
  constructor(id: number) { this.id = id }
}
const names = ["a0", "a5", "b0", "b5", "c0", "c5", "d4", "d9"] as const
const fitting = (w: Wide): Record<string, unknown> => ({ a0: 10.5, a5: "got", b0: w, b5: false, c0: "anything", c5: [9], d4: -3, d9: "" })

const text: any = (0, eval)(`({
  accessor(o, k, v) { Object.defineProperty(o, k, { get() { return this === o ? v : "wrong receiver"; }, set(x) { this.last = "set " + typeof x; }, enumerable: true, configurable: true }); },
  hidden(o, k) { Object.defineProperty(o, k, { enumerable: false }); },
  readOnly(o, k) { Object.defineProperty(o, k, { writable: false }); },
  defined(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); },
  definedHidden(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true }); },
  remove(o, k) { delete o[k]; },
  removeAndAdd(o, k) { delete o[k]; o[k] = undefined; },
  filledThenAccessor(o, k, v) { o[k] = v; Object.defineProperty(o, k, { get() { return v; }, enumerable: true, configurable: true }); },
  accessorThenValue(o, k, v) { Object.defineProperty(o, k, { get() { return v; }, enumerable: true, configurable: true }); Object.defineProperty(o, k, { value: v, writable: true }); },
  frozen(o, k) { Object.freeze(o); },
  otherKind(o, k) { o[k] = Symbol.for("other"); },
  store(o, k, v) { "use strict"; o[k] = v; return typeof o[k]; },
})`)

function readTyped(w: Wide): string { return [w.id, w.a0, w.a5, w.b0 === undefined ? "none" : w.b0.id, w.b5, String(w.c0), w.c5 === undefined ? "none" : w.c5.length, w.d4, w.d9, w.last].map(String).join(",") }
function readUntyped(w: any): string { return [w.id, w.a0, w.a5, typeof w.b0, w.b5, w.c0, typeof w.c5, w.d4, w.d9, w.last].map(String).join(",") }
function fillTyped(w: Wide): void { w.a0 = 1; w.a5 = "s"; w.b0 = w; w.b5 = true; w.c0 = 2; w.c5 = [3]; w.d4 = 4; w.d9 = "t" }
function seen(o: any): string {
  const keys = Object.keys(o)
  return [keys.length, keys.filter(k => !/^[a-d][0-9]$/.test(k) || names.includes(k as any)).join(), Reflect.ownKeys(o).length, Object.keys({ ...o }).length, JSON.stringify(o, (k, v) => k.startsWith("b") && v instanceof Wide ? "wide" : typeof v === "symbol" ? "symbol" : v).length, keys.indexOf("d9"), keys.indexOf("last")].join(" ; ")
}

for (const alteration of Object.keys(text)) {
  if (alteration === "store") continue
  for (const name of names) {
    const w = new Wide(1)
    text[alteration](w, name, fitting(w)[name])
    const descriptor = Object.getOwnPropertyDescriptor(w, name)
    // Typed code is not shown a field that no longer holds what its type says.
    const read = alteration === "otherKind" && name !== "c0" ? readUntyped : readTyped
    show(alteration + ", " + name, read(w), seen(w), name in w, Object.hasOwn(w, name), descriptor ? Object.keys(descriptor).join() + " " + descriptor.enumerable + descriptor.configurable : "none",
      outcome(() => text.store(w, name, undefined)), outcome(() => { fillTyped(w); return readTyped(w) }), seen(w))
  }
}

const list: Wide[] = []
for (let i = 0; i < 500; i++) {
  const w = new Wide(i)
  if (i % 2 === 0) text.accessor(w, "a5", "got " + i)
  if (i % 3 === 0) text.hidden(w, "d4")
  if (i % 5 === 0) w.c5 = [i]
  list.push(w)
}
Bun.gc(true)
let right = 0
for (let i = 0; i < list.length; i++) {
  const w = list[i]
  if (w.a5 === (i % 2 === 0 ? "got " + i : undefined) && Object.keys(w).includes("d4") === (i % 3 !== 0) && (w.c5 === undefined) === (i % 5 !== 0) && w.d4 === undefined) right++
}
show("500 objects", right)
export {}
