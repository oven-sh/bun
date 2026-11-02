// RUN: lower
// OPTIONS: builtin-modules

// Narrowing a record from one closed record type to another must not copy it.
type Item = { kind: "prompt" | "other"; name: string }
type Built = { item: Item | undefined; path: string }
type WithPath = { item: Item; path: string }
function build(names: string[]): Built[] { return names.map((n): Built => ({ item: n === "" ? undefined : { kind: "prompt", name: n }, path: "/p/" + n })) }
function made(): WithPath { return { item: { kind: "other", name: "made" }, path: "/made" } }
function report(label: string, narrowed: WithPath | undefined, original: Built) {
  if (narrowed === undefined) { console.log(label, "nothing"); return }
  narrowed.path += "!"
  narrowed.item.name += "?"
  console.log(label, narrowed === original, original.path, original.item?.name, narrowed.path, narrowed.item.name, made().path)
}
const built = build(["a", "", "b"])
function keep<T, S extends T>(list: T[], test: (x: T) => x is S): S[] { const out: S[] = []; for (const x of list) if (test(x)) out.push(x); return out }
report("helper", keep(built, (r): r is WithPath => r.item !== undefined)[0], built[0]!)

// GENERATED: build keep
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|[[L_2]]> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="map"
// CHECK-NEXT: v2 = NewClosure function=[[f_4]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="map" calleeName="names.map"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|Array<undefined|null|[[L_2]]> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|[[L_2]]> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_6]]> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|[[L_10]]> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_6]]>, v1: undefined|null|[[f_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|[[L_10]]> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_6]] site=[[w_14]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v10 = Call v1, -, v9 calleeName="test"
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean site=[[w_15]]}
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v13) handler=b10():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: v14 = PropGet v3 key="push"
// CHECK-NEXT: v15 = Convert v9 declared={type=undefined|null|[[L_10]]} illTypedCause=Assertion
// CHECK-NEXT: v16 = Call v14, v3, v15 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_16]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b8(v18) handler=b10():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b10() role=IterationCleanup subject=v4:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
