// RUN: lower
// OPTIONS: builtin-modules

// Unions lists optionals enums and tuples together.
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "none" };
function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return s.r * s.r * 3;
    case "square": return s.side * s.side;
    default: return 0;
  }
}
const shapes: Shape[] = [{ kind: "circle", r: 2 }, { kind: "square", side: 3 }, { kind: "none" }];
console.log(shapes.map(area).join());
const byKind = new Map<string, Shape[]>();
for (const s of shapes) (byKind.get(s.kind) ?? byKind.set(s.kind, []).get(s.kind)!).push(s);
console.log([...byKind].map(([k, v]) => k + v.length).join());
class Node<T> { next: Node<T> | null = null; constructor(public value: T) {} }
class List<T> implements Iterable<T> {
  head: Node<T> | null = null; size = 0;
  push(value: T): this { const n = new Node(value); n.next = this.head; this.head = n; this.size++; return this; }
  *[Symbol.iterator](): Iterator<T> { for (let n = this.head; n; n = n.next) yield n.value; }
}
const list = new List<Shape>().push(shapes[0]).push(shapes[1]);
console.log([...list].map(s => s.kind).join(), list.size);
const empty = new List<number>();
console.log([...empty].length, empty.head === null, Math.max(0, ...empty));
function first<T>(items: readonly T[], fallback: T): T { return items.length ? items[0] : fallback; }
console.log(first([], "fallback"), first([1], 2), first<Shape>([], { kind: "none" }).kind);
const optional: { a?: { b?: { c: number } } } = {};
console.log(optional.a?.b?.c ?? "nothing", optional?.a?.b === undefined);
optional.a = { b: { c: 5 } };
console.log(optional.a?.b?.c ?? "nothing");
enum Color { Red, Green = 5, Blue }
const names: Record<Color, string> = { [Color.Red]: "r", [Color.Green]: "g", [Color.Blue]: "b" };
console.log(Object.keys(names).join(), names[Color.Blue], Color[6], Color.Green);
const tuple: [string, number, ...boolean[]] = ["t", 1];
tuple.push(true);
console.log(tuple.length, tuple[2], tuple.slice(1).join());
async function load(id: number): Promise<{ id: number; tags: string[] }> { await null; return { id, tags: id ? ["x"] : [] }; }
Promise.all([load(0), load(1)]).then(rows => console.log(rows.map(r => r.id + ":" + r.tags.length + ":" + (r.tags[0]?.length ?? "-")).join()));

// GENERATED: load List push [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|Promise<undefined|null|[[L_2]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Null
// CHECK-NEXT: v3 = Await v2, v1
// CHECK-NEXT: v4 = Convert v3 declared={type=null site=[[w_3]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v5 = Convert v1 declared={type=number}
// CHECK-NEXT: v6 = ToBoolean v1
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Data data=[[d_5]]
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = NewObject -, v5, v12 layout=[[L_2]] fields=[0, 1]
// CHECK-NEXT: v14 = FinishObject v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|object site=[[w_6]]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="List"
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
// CHECK-LABEL: function {{*}}name="push"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_7]] site=[[w_9]]} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]]}] results=[{type=undefined|null|[[L_7]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_7]], v1: undefined|null|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Node"
// CHECK-NEXT: v4 = Construct v3, -, v1 calleeName="Node"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_14]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = PropGet v0 key="head"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_14]] site=[[w_16]] flags=[OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v7 key="next"
// CHECK-NEXT: PropSet v0, v5 key="head"
// CHECK-NEXT: v10 = PropGet v0 key="size"
// CHECK-NEXT: v11 = Increment v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_17]]}
// CHECK-NEXT: PropSet v0, v12 key="size"
// CHECK-NEXT: v14 = Convert v0 declared={type=undefined|null|[[L_7]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsChecked, IsNamedByComputedKey] thisType={type=[[L_7]] site=[[w_18]]} results=[{type=undefined|null|Generator<undefined|null|[[L_10]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_7]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = PropGet v0 key="head"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_14]] site=[[w_19]] flags=[OmitsUndefined]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5: undefined|null|[[L_14]]):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = ToBoolean v5
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b9(| 0)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = PropGet v8 key="value"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_10]] site=[[w_20]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Yield v10
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Switch v13 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v12
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v14 = PropGet v8 key="next"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_14]] site=[[w_19]] flags=[OmitsUndefined]}
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b9(v16):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
