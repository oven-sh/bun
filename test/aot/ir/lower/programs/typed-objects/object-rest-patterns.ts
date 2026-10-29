// RUN: lower
// OPTIONS: builtin-modules

// Destructuring of typed objects: rest objects, defaults, renames, nested patterns, computed keys, parameters, and assignment patterns into fields.
interface Props { id: number; title: string; hidden?: boolean; size?: number; style: { color: string; width?: number } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const props: Props = { title: "t", id: 1, style: { color: "red" }, size: 0 }

// The rest object has the remaining properties, in source order, and is a new plain object.
const { id, ...withoutId } = props
const { style, title, ...small } = props
const { ...everything } = props
console.log(id, show(withoutId), title, style === props.style, show(small), show(everything), everything !== props)
const { hidden, ...noHidden } = props
console.log(hidden, show(noHidden), "hidden" in noHidden)

// Defaults apply to undefined and to absent, not to other falsy values or null.
function defaults({ id, hidden = true, size = 10, title = "none" }: Partial<Props>): string { return [id, hidden, size, title].join() }
console.log(defaults(props), defaults({}), defaults({ hidden: false, size: undefined, title: "" }), defaults({ size: NaN }))
const effects: string[] = []
function note<T>(label: string, v: T): T { effects.push(label); return v }
const { size: sz = note("size default", 5), hidden: hd = note("hidden default", false) } = props
console.log(sz, hd, effects.join())

// Nested patterns and renames.
const { style: { color, width = 3, ...styleRest }, id: renamed } = props
console.log(color, width, show(styleRest), renamed)
function nestedDefault({ style: { color = "none" } = { color: "fallback" } }: { style?: { color?: string } }): string { return color }
console.log(nestedDefault({}), nestedDefault({ style: {} }), nestedDefault({ style: { color: "blue" } }))

// Computed keys: evaluated in order, left out of the rest.
const which = "title"
const { [which]: chosen, ...others } = props
console.log(String(chosen), show(others))

// Extra properties, symbols and indices added through `any` end up in the rest object; non-enumerable ones do not.
const sym = Symbol("s")
const dressed: Props = { id: 2, title: "d", style: { color: "c" } }
const anyDressed: any = dressed
anyDressed.extra = 1; anyDressed[sym] = 2; anyDressed[0] = 3
Object.defineProperty(dressed, "secret", { value: 4, enumerable: false })
const { title: dressedTitle, ...dressedRest } = dressed
console.log(dressedTitle, show(dressedRest), (dressedRest as any)[sym], "secret" in dressedRest, Reflect.ownKeys(dressedRest).length)

// Getters run in the order of the pattern, then the rest in the order of the keys.
const trace: string[] = []
const live = { get a() { trace.push("a"); return 1 }, get b() { trace.push("b"); return 2 }, get c() { trace.push("c"); return 3 }, get d() { trace.push("d"); return 4 } }
const { c: liveC, a: liveA, ...liveRest } = live
console.log(liveC, liveA, show(liveRest), trace.join())

// Class instances: inherited members can be picked, the rest has own fields only.
class Widget { x = 1; y = 2; get area() { return this.x * this.y } grow() { return ++this.x } }
const { area, grow, x: wx, ...widgetRest } = new Widget()
console.log(area, typeof grow, wx, show(widgetRest), attempt(() => grow()))

// Plain data used as the type.
const parsed: Props = JSON.parse('{"style":{"color":"j","width":1},"title":"json","more":[1],"id":9}')
const { id: parsedId, style: { width: parsedWidth }, ...parsedRest } = parsed
console.log(parsedId + 1, parsedWidth, show(parsedRest))

// Nothing to destructure.
console.log(attempt(() => { const { id } = undefined as unknown as Props; return id }), attempt(() => { const { ...r } = null as unknown as Props; return r }), attempt(() => { const { style: { color } } = { id: 1 } as unknown as Props; return color }))

// Assignment patterns store into typed fields and swap them.
interface Pt { x: number; y: number; tag?: string }
const pt: Pt = { x: 1, y: 2 }
;({ x: pt.y, y: pt.x } = pt)
console.log(show(pt))
;[pt.x, pt.y] = [pt.y, pt.x]
;({ title: pt.tag, id: pt.x = 50 } = props)
console.log(show(pt))
const bucket: { rest?: object; first?: number } = {}
;({ id: bucket.first, ...bucket.rest } = props)
console.log(bucket.first, show(bucket.rest ?? {}), Object.keys(bucket).join())

// In loops and callbacks.
const items: Props[] = [props, dressed, parsed]
const seen: string[] = []
for (const { id, title, size = -1, ...more } of items) seen.push(id + title + size + Object.keys(more).length)
console.log(seen.join(), items.map(({ style: { color }, hidden = false }) => color + hidden).join())

// GENERATED: defaults Widget area grow
// CHECK-LABEL: function {{*}}name="defaults"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="id"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="id"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v4 key="hidden"
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b7(v12):
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean} illTypedCause=Assertion
// CHECK-NEXT: v15 = PropGet v4 key="size"
// CHECK-NEXT: v16 = TypeTest v15 testedType=undefined
// CHECK-NEXT: Branch v16 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v17):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v18 = Integer integer=10
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b12(v19)
// CHECK-NEXT: b11(v20):
// CHECK-NEXT: Jump -> next b12(v20)
// CHECK-NEXT: b12(v21):
// CHECK-NEXT: v22 = Convert v21 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v4 key="title"
// CHECK-NEXT: v24 = TypeTest v23 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b13(| 0), notTaken b15(| 0)
// CHECK-NEXT: b13(v25):
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v26 = String string="none"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b16(v27)
// CHECK-NEXT: b15(v28):
// CHECK-NEXT: Jump -> next b16(v28)
// CHECK-NEXT: b16(v29):
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v31 = NewArray v6, v14, v22, v30 contents=undefined|null|boolean|number|string
// CHECK-NEXT: v32 = PropGet v31 key="join"
// CHECK-NEXT: v33 = Call v32, v31 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v33 casts=[{declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Widget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_9]]} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_11]]} results=[{type=number site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_14]]}
// CHECK-NEXT: PropSet v0, v3 key="x"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
