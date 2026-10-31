// RUN: lower
// OPTIONS: builtin-modules

// Unions discriminated by a string field: `switch`, `if` chains, destructuring, filters.
type Circle = { kind: "circle"; radius: number }
type Square = { kind: "square"; side: number }
type Rect = { kind: "rect"; width: number; height: number }
type Empty = { kind: "empty" }
type Shape = Circle | Square | Rect | Empty
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return 3 * s.radius ** 2
    case "square": return s.side * s.side
    case "rect": return s.width * s.height
    case "empty": return 0
  }
}
function sides(s: Shape): number { if (s.kind === "circle" || s.kind === "empty") return 0; return s.kind === "square" ? s.side * 4 : 2 * (s.width + s.height) }
function viaLocal(s: Shape): string { const { kind } = s; const k = s.kind; return kind === k ? kind.length + kind[0] : "differs" }
const shapes: Shape[] = [{ kind: "circle", radius: 1 }, { side: 2, kind: "square" }, { width: 2, kind: "rect", height: 3.5 }, { kind: "empty" }, { radius: 0.5, kind: "circle" }]
console.log(shapes.map(area).join(), shapes.map(sides).join(), shapes.map(viaLocal).join(), shapes.map(show).join(" ; "))

// The same text, made at run time: a rope, a slice, a parsed string.
const pieces = ["cir", "cle", "squ", "are"]
const joined = (pieces[0] + pieces[1]) as "circle"
const sliced = "xxsquarexx".slice(2, 8) as "square"
const made: Shape[] = [{ kind: joined, radius: 2 }, { kind: sliced, side: 3 }, JSON.parse('{"kind":"rect","width":1,"height":2}'), JSON.parse('{"radius":3,"kind":"circle"}'), { kind: String(["empty"]) as "empty" }]
console.log(made.map(area).join(), made.map(sides).join(), made.map(viaLocal).join(), made.map(s => s.kind === shapes[0].kind).join())

const circles = [...shapes, ...made].filter((s): s is Circle => s.kind === "circle")
console.log(circles.map(c => c.radius).join(), circles.length)
const tally: Record<Shape["kind"], number> = { circle: 0, square: 0, rect: 0, empty: 0 }
for (const s of [...shapes, ...made]) tally[s.kind]++
console.log(show(tally))

// One payload name, another kind in each branch.
type Lit = { kind: "num"; value: number } | { kind: "str"; value: string } | { kind: "bool"; value: boolean } | { kind: "obj"; value: { inner: number } } | { kind: "list"; value: Lit[] } | { kind: "nil"; value: null }
function render(l: Lit): string {
  switch (l.kind) {
    case "num": return Object.is(l.value, -0) ? "-0" : String(l.value + 0)
    case "str": return '"' + l.value.toUpperCase() + '"'
    case "bool": return l.value ? "yes" : "no"
    case "obj": return "{" + l.value.inner + "}"
    case "list": return "[" + l.value.map(render).join() + "]"
    case "nil": return String(l.value)
  }
}
const lits: Lit[] = [{ kind: "num", value: 1.5 }, { value: "s", kind: "str" }, { kind: "bool", value: false }, { kind: "obj", value: { inner: 4 } }, { kind: "nil", value: null }, { kind: "num", value: -0 }, { kind: "num", value: NaN }]
lits.push({ kind: "list", value: lits.slice(0, 3) }, { kind: "list", value: [] })
console.log(lits.map(render).join(" "), lits.map(l => typeof l.value).join())

// A reducer: every action is an branch, the state is copied by spread.
type Item = { id: number; label: string; done?: boolean }
type State = { items: Item[]; nextId: number; last?: Action["type"] }
type Action = { type: "add"; label: string } | { type: "remove"; id: number } | { type: "toggle"; id: number } | { type: "rename"; id: number; label: string } | { type: "clear" }
function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "add": return { ...state, items: [...state.items, { id: state.nextId, label: action.label }], nextId: state.nextId + 1, last: action.type }
    case "remove": return { ...state, items: state.items.filter(i => i.id !== action.id), last: "remove" }
    case "toggle": return { ...state, last: action.type, items: state.items.map(i => i.id === action.id ? { ...i, done: !i.done } : i) }
    case "rename": return { last: action.type, ...state, items: state.items.map(i => i.id === action.id ? { ...i, label: action.label } : i) }
    default: return { items: [], nextId: state.nextId }
  }
}
const actions: Action[] = [{ type: "add", label: "a" }, { type: "add", label: "b" }, { type: "toggle", id: 1 }, { label: "B", type: "rename", id: 2 }, { type: "toggle", id: 1 }, { type: "remove", id: 1 }, { type: "add", label: "c" }, { type: "clear" }, { type: "add", label: "d" }]
let state: State = { items: [], nextId: 1 }
for (const action of actions) { state = reduce(state, action); console.log(action.type, show(state)) }

// Nested unions, narrowed two levels deep.
type Reply = { status: "ok"; body: Shape } | { status: "error"; reason: { code: number; kind: "fatal" | "retry" } } | { status: "pending" }
function summarize(r: Reply): string {
  if (r.status === "ok") return r.body.kind === "circle" ? "circle of " + r.body.radius : r.body.kind + " of area " + area(r.body)
  if (r.status === "error") return r.reason.kind === "fatal" ? "fatal " + r.reason.code : "retry"
  return r.status
}
console.log(([{ status: "ok", body: shapes[0] }, { body: made[1], status: "ok" }, { status: "error", reason: { code: 5, kind: "fatal" } }, { status: "error", reason: { kind: "retry", code: 0 } }, { status: "pending" }] as Reply[]).map(summarize).join(" ; "))

let total = 0
const everything = [...shapes, ...made]
for (let i = 0; i < 5000; i++) total += area(everything[i % everything.length]) + render(lits[i % lits.length]).length
console.log(total)

// GENERATED: area show
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]|[[L_3]]|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: SwitchString v1 strings=["circle", "square", "rect", "empty"] -> case b2(| 0), case b4(| 0), case b6(| 0), case b8(| 0), otherwise b10()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: v3 = NarrowByField v0, v2 key="kind"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Integer integer=3
// CHECK-NEXT: v5 = Convert v3 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="radius"
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Pow v6, v7
// CHECK-NEXT: v9 = Mul v4, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = NarrowByField v0, v11 key="kind"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_4]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = PropGet v13 key="side"
// CHECK-NEXT: v15 = PropGet v13 key="side"
// CHECK-NEXT: v16 = Mul v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = NarrowByField v0, v18 key="kind"
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_3]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = PropGet v20 key="width"
// CHECK-NEXT: v22 = PropGet v20 key="height"
// CHECK-NEXT: v23 = Mul v21, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: b8(v25):
// CHECK-NEXT: v26 = NarrowByField v0, v25 key="kind"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: b10():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: v30 = Convert v29 declared={type=number site=[[w_6]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v9, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
