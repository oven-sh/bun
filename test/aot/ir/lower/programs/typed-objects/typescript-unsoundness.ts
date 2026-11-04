// RUN: lower
// OPTIONS: builtin-modules

// Every known unsoundness of TypeScript's type system, at least one case each: a value reaches a place of another type without a type error. Where a written type meets a value of another kind, the compiled program throws a TypeError; every other row goes on as in plain Bun.
const row = (what: string, f: () => unknown) => { let said: string; try { said = String(f()) } catch (e) { said = "THROWS " + (e as Error).constructor.name } console.log(what + ": " + said) }
const kindOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
type Point = { x: number; y: number; tag?: string }
type Named = { name: string }
const hidden: any = { text: "twelve", nothing: undefined, point: { x: "1" }, list: "no list", count: "12", flag: 0 }
// 1. `any` to T: an annotation, an argument, a result, a field
const takesNumber = (n: number) => kindOf(n) + ":" + (n + 1)
const takesPoint = (p: Point) => kindOf(p.x) + ":" + (p.x + p.y)
const yieldsNumber = (): number => hidden.text
class Keeps { n: number = 0; p: Point = { x: 0, y: 0 } }
row("any to an annotated variable", () => { const n: number = hidden.count; return kindOf(n) + ":" + (n + 1) })
row("any to a parameter", () => takesNumber(hidden.count))
row("any to a parameter of a record", () => takesPoint(hidden.point))
row("any as a result", () => kindOf(yieldsNumber()) + ":" + yieldsNumber().toString().length)
row("any to a field", () => { const k = new Keeps(); k.n = hidden.text; k.p = hidden.point; return kindOf(k.n) + ":" + kindOf(k.p.y) })
// 4. element and index-signature reads
row("an element that is not there", () => { const list: number[] = [1, 2]; const n = list[5]; return kindOf(n) + ":" + (n + 1) })
row("an element of records that is not there", () => { const list: Point[] = []; const p = list[0]; return kindOf(p) + ":" + (p ? p.x : "none") })
row("a key that is not there", () => { const d: Record<string, Named> = {}; const v = d["absent"]; return kindOf(v) + ":" + (v && v.name) })
row("a key of numbers that is not there", () => { const d: { [k: string]: number } = { a: 1 }; const v = d.b; return kindOf(v) + ":" + (v > 0) + ":" + (v | 0) })
row("a hole of an array", () => { const list: string[] = new Array<string>(2); return kindOf(list[0]) + ":" + list.length })
row("a character that is not there", () => { const s = "ab"; const c = s[5]; return kindOf(c) + ":" + (c + "!") })
// 5. values of declarations without a body, and the parameters of callbacks they call
declare function hostValue(): Point
declare function hostEach(f: (p: Point, index: number) => void): void
;(globalThis as any).hostValue = () => ({ x: "left" })
;(globalThis as any).hostEach = (f: Function) => { f({ y: 1 }, "zero"); f(null, 1) }
row("what a declared function yields, annotated", () => { const p: Point = hostValue(); return takesPoint(p) })
row("the parameters of a callback", () => { const seen: string[] = []; hostEach((p, index) => { seen.push(kindOf(p) + "/" + kindOf(index) + "/" + (p ? kindOf(p.x) : "-")) }); return seen.join() })
// 6. JSON, payloads
row("parsed, annotated", () => { const p: Point = JSON.parse('{"x":"a"}'); return kindOf(p.x) + ":" + kindOf(p.y) })
row("parsed, handed on", () => takesPoint(JSON.parse('{"x":1}')))
// 7. catch variables
row("a catch variable", () => { try { throw "a string" } catch (e: any) { const message: string = e.message; return kindOf(message) } })
row("what is thrown is no Error", () => { try { throw { code: 7 } } catch (e) { return e instanceof Error ? e.message : kindOf(e) } })
// 8. an optional property read as present (a spread and an assignment drop it; `in` narrows wrongly)
row("an optional property stored as undefined", () => { const p: Point = { x: 1, y: 2, tag: undefined }; return ("tag" in p) + ":" + kindOf(p.tag) + ":" + Object.keys(p).join() })
row("`in` narrows to what is not there", () => { const v: Point | Named = { x: 1, y: 2, name: 5 } as unknown as Point; return "name" in v ? kindOf(v.name) : "a point" })
// 9. `!:` and a read before the first store
class Late { value!: number; name!: string; twice() { return this.value * 2 } }
row("a field that is said to be assigned", () => { const l = new Late(); return kindOf(l.value) + ":" + l.twice() + ":" + kindOf(l.name) })
row("a variable that is said to be assigned", () => { let n!: number; const read = () => n; return kindOf(read()) + ":" + (read() + 1) })
row("a field read in the constructor before it is stored", () => { class Early { seen: string; n: number; constructor() { this.seen = kindOf(this.peek()); this.n = 1 } peek() { return this.n } } return new Early().seen })
// 10. type guards and assertion functions that lie
const isPoint = (v: unknown): v is Point => true
function assertNamed(v: unknown): asserts v is Named {}
row("a type guard that lies", () => { const v: unknown = "no point"; return isPoint(v) ? kindOf(v.x) + ":" + kindOf(v) : "never" })
row("an assertion function that lies", () => { const v: unknown = 5; assertNamed(v); return kindOf(v.name) + ":" + kindOf(v) })
row("a guard that lies about a primitive", () => { const isText = (v: unknown): v is string => true; const v: unknown = 42; return isText(v) ? kindOf(v) + ":" + kindOf(v.length) : "never" })
// 11. bivariance of methods and of callbacks
interface Handler { handle(p: Point | Named): string }
row("a method takes less than it is declared to", () => { const narrow = { handle(p: Point) { return kindOf(p.x) } }; const h: Handler = narrow; return h.handle({ name: "n" }) })
// 12. arrays are covariant
row("an array looked at as an array of more", () => { const points: Point[] = [{ x: 1, y: 2 }]; const wider: (Point | Named)[] = points; wider.push({ name: "n" }); return points.map(p => kindOf(p.x)).join() })
// a record viewed as a wider one, and written through it
row("a field written through a wider type", () => { const p: { v: number } = { v: 1 }; const wider: { v: number | string } = p; wider.v = "text"; return kindOf(p.v) + ":" + (p.v + 1) })
// 13. generics with `any`
const identity = <T,>(v: T): T => v
const firstOf = <T,>(list: T[]): T => list[0]
row("a generic function instantiated through any", () => { const n: number = identity<any>("text"); return kindOf(n) })
row("a generic function on an empty array", () => { const n = firstOf<number>([]); return kindOf(n) + ":" + (n + 1) })
row("a container of any", () => { const m = new Map<string, any>([["a", "text"]]); const n: number = m.get("a"); return kindOf(n) })
// 14. an enum from a number
enum Color { Red, Green }
enum Mask { A = 1, B = 2 }
row("a number that is no member", () => { const seven: number = Number("7"); const c: Color = seven; return kindOf(Color[c]) + ":" + (c === Color.Red || c === Color.Green) })
row("a switch over an enum falls through", () => { const name = (c: Color): string => { switch (c) { case Color.Red: return "red"; case Color.Green: return "green" } }; return kindOf(name(9 as Color)) })
row("flags combined", () => { const m: Mask = Mask.A | Mask.B; return m + ":" + kindOf(Mask[m]) })
// 15. Object.assign and a spread of external data
row("Object.assign of what is given", () => { const p: Point = Object.assign({ x: 1, y: 2 }, JSON.parse('{"x":"a","extra":true}')); return kindOf(p.x) + ":" + Object.keys(p).join() })
row("a spread of what is given", () => { const p: Point = { x: 1, y: 2, ...JSON.parse('{"y":null}') }; return kindOf(p.y) + ":" + (p.x + p.y) })
row("a spread of any", () => { const p: Point = { x: 1, y: 2, ...hidden.point }; return kindOf(p.x) })
// 16. a method without its `this`
class Counter { n = 1; next() { return kindOf(this) + ":" + (this ? kindOf(this.n) : "-") } }
row("a method taken off its object", () => { const next = new Counter().next; return next() })
row("a method on another object", () => { const next = new Counter().next; return next.call({ n: "text" } as unknown as Counter) })
row("a method as a callback", () => [1].map(new Counter().next).join())
// others: `void` results, `Object.keys`, a readonly written through, a default that is skipped by null, a tuple that is longer
row("a function that returns more than void", () => { const f: () => void = () => 5; const v = f(); return kindOf(v) })
row("null where a default is expected", () => { const withDefault = (n: number = 3) => kindOf(n); return withDefault(hidden.nothing) + ":" + withDefault(JSON.parse("null")) })
row("a readonly field written through another type", () => { const frozen: { readonly v: number } = { v: 1 }; const open: { v: number } = frozen; open.v = 2; return frozen.v })
row("a tuple that is pushed to", () => { const pair: [number, number] = [1, 2]; pair.push(3); return pair.length + ":" + kindOf(pair[1]) })
row("a numeric key read as a string key", () => { const d: Record<number, string> = { 1: "one" }; return Object.keys(d).map(kindOf).join() })
// 2., 3. `as` and `!`: `!` tests nothing, and `as` tests what every written type tests
row("rule: `!` on what is nil", () => { const list: Point[] = []; const p = list[0]!; return kindOf(p) })
row("rule: `!` on an optional property", () => { const p: Point = { x: 1, y: 2 }; const t = p.tag!; return kindOf(t) })
row("rule: `as` to a record of what is none", () => { const p = hidden.text as Point; return kindOf(p) })
row("rule: `as` between primitives", () => { const n = hidden.count as number; return kindOf(n) + ":" + (n + 1) })
export {}

// GENERATED: Keeps twice kindOf handle name
// CHECK-LABEL: function {{*}}name="Keeps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = String string="null"
// CHECK-NEXT: Jump -> next b7(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v7 = TypeTest v5 testedType=Array
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = NarrowByTest v0, v9
// CHECK-NEXT: v11 = Builtin builtin=Array
// CHECK-NEXT: v12 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v13 = Call v12, v11, v10 calleeName="Array.isArray"
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b5(v9), notTaken b6(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = String string="array"
// CHECK-NEXT: Jump -> next b7(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = TypeOf v10
// CHECK-NEXT: Jump -> next b7(v19)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="handle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="kindOf"
// CHECK-NEXT: v3 = PropGet v0 key="x"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="kindOf"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=i32}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: Switch v0 cases=[0, 1] -> case b1(| 0), case b2(| 0), otherwise b3()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = String string="red"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = String string="green"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
