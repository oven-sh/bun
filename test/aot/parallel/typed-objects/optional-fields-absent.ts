// Optional fields of a type are read, tested, written and deleted on objects that were created as other types without them.
interface Core { id: number }
interface Rich extends Core { count?: number; text?: string; flag?: boolean; child?: Core; run?: () => string; either?: number | string }
type Lean = { id: number; own: string }
class Instance { id = 3; own = "class" }
const optionalNames = ["count", "text", "flag", "child", "run", "either"]
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function probe(r: Rich): string {
  return [r.count, r.text, r.flag, r.child === undefined ? "none" : r.child.id, r.run?.(), r.either].map(String).join("|") + " " +
    optionalNames.map(k => (k in r ? "1" : "0") + (Object.hasOwn(r, k) ? "1" : "0")).join("")
}
const core: Core = { id: 1 }
const lean: Lean = { id: 2, own: "lean" }
const instance = new Instance()
const bare: Rich = { id: 4 }
const explicit: Rich = { id: 5, count: undefined, text: undefined, flag: undefined, child: undefined, run: undefined, either: undefined }
const some: Rich = { flag: false, id: 6, count: 0, text: "" }
const views: Rich[] = [core, lean, instance, bare, explicit, some]
console.log(views.map(probe).join(" ; "))
console.log(views.map(show).join(" ; "))

function fill(r: Rich, n: number): void { r.count = n; r.flag = n > 2; if (n % 2) r.text = "t" + n; else r.either = n }
views.forEach((r, i) => fill(r, i))
console.log(views.map(probe).join(" ; "))
console.log(views.map(show).join(" ; "))
console.log(lean.own, instance.own, Object.keys(lean).join(), Object.keys(instance).join(), (lean as any).count, (instance as any).flag, instance instanceof Instance)

// Objects, functions and a union, late.
const leanAsRich: Rich = lean
leanAsRich.child = core
leanAsRich.run = () => "ran " + lean.own
leanAsRich.either = "str"
console.log(probe(lean), show(lean), leanAsRich.child === core)
leanAsRich.either = 2.5
leanAsRich.child = leanAsRich
console.log(leanAsRich.either, leanAsRich.child === lean, leanAsRich.child.id, Object.keys(lean).join())

// Deleted, then stored again: the key moves to the end. A store of undefined keeps the key.
function cycle(r: Rich): string {
  const steps: string[] = []
  steps.push(String(delete r.count), String(r.count), String("count" in r), Object.keys(r).join(""))
  r.count = 8
  steps.push(String(r.count), Object.keys(r).join(""))
  r.count = undefined
  steps.push(String(r.count), String("count" in r), Object.keys(r).join(""), JSON.stringify(r, (k, v) => k === "child" ? undefined : v))
  return steps.join(",")
}
console.log(views.map(cycle).join(" ; "))

// Operators that read before they store.
function operators(r: Rich): string {
  delete r.count; delete r.text; delete r.flag
  r.count ??= 7
  r.count ??= 8
  r.text ||= "filled"
  r.flag &&= false
  const before = "flag" in r
  r.flag ||= true
  r.count = (r.count ?? 0) + 1
  return [r.count, r.text, r.flag, before, Object.keys(r).join("")].join("/")
}
console.log(views.map(operators).join(" ; "))

// Values a compiler might have set aside to mean "absent".
const edges = [0, -0, -1, NaN, 2147483647, -2147483648, 4294967295, 2147483648, -2147483649, 9007199254740991, Infinity, 5e-324]
console.log(edges.map(v => { const r: Rich = { id: 0 }; const c: Core = r; (c as Rich).count = v; return (r.count === undefined ? "LOST" : Object.is(r.count, v)) + ("count" in r ? "" : "ABSENT") }).join())
console.log(["", "undefined", "null", "\0"].map(v => { const r: Rich = { id: 0 }; r.text = v; return (r.text === undefined ? "LOST" : r.text === v) + String("text" in r) }).join())

// No room is taken where the object does not allow a new property.
const sealedCore: Core = Object.preventExtensions({ id: 9 })
try { (sealedCore as Rich).count = 1; console.log("stored") } catch (e) { console.log((e as Error).constructor.name) }
console.log(show(sealedCore), probe(sealedCore))
const sealedRich: Rich = Object.seal<Rich>({ id: 10, text: "kept" })
try { sealedRich.count = 1; console.log("stored") } catch (e) { console.log((e as Error).constructor.name) }
sealedRich.text = "changed"
try { delete sealedRich.text; console.log("deleted") } catch (e) { console.log((e as Error).constructor.name) }
console.log(show(sealedRich), probe(sealedRich))

let total = 0
for (let i = 0; i < 3000; i++) { const r = views[i % views.length]; total += (r.count ?? 1) + (r.text ?? "").length + (r.flag ? 1 : 0) + (r.child?.id ?? 0) }
console.log(total)
