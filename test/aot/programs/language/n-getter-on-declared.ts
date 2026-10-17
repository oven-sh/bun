// A declared property of a typed object is redefined as a getter, by a key that can be one of several names.
type Item = { kind: "a"; name: string; label: string; hint?: string; note?: string; run(): number }
function later(item: Item, key: "label" | "hint" | "note", value: string | (() => string | undefined) | undefined): void {
  if (typeof value !== "function") return
  Object.defineProperty(item, key, { get: value, enumerable: true, configurable: true })
}
const list: Item[] = []
function register(d: { name: string; label: string | (() => string); hint?: string | (() => string | undefined) }) {
  const item: Item = { kind: "a", name: d.name, label: typeof d.label === "string" ? d.label : "", hint: typeof d.hint === "string" ? d.hint : undefined, run() { return this.name.length } }
  later(item, "label", d.label); later(item, "hint", d.hint)
  list.push(item)
}
let n = 0
register({ name: "one", label: "plain" })
register({ name: "two", label: () => "made " + ++n, hint: () => undefined })
register({ name: "three", label: () => "made " + ++n, hint: "h" })
for (const i of list) console.log(i.name, i.label, i.label, String(i.hint), i.run(), Object.keys(i).join(), JSON.stringify(i))
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(list[1], "label"), (k, v) => typeof v === "function" ? "fn" : v))
