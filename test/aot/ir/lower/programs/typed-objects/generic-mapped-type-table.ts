// RUN: lower
// OPTIONS: builtin-modules

// A table typed by a mapped type over a union of names is filled by spreading the results of a generic helper.
type Name = "a.one" | "a.two" | "b.one" | "b.two" | "c.one";
interface Arguments { "a.one": { n: number }; "a.two": { s: string }; "b.one": { n: number; s: string }; "b.two": {}; "c.one": { flag: boolean } }
interface Entry<E extends Name> { readonly key: E; readonly kind: "plain" | "checked" | "own"; check(args: Arguments[E]): boolean }
function plainEntry<E extends Name>(key: E): Entry<E> { return { key, kind: "plain", check: () => true }; }
function checkedEntry<E extends Name>(key: E): Entry<E> { return { key, kind: "checked", check: args => args !== undefined }; }
function tableOf<K extends Name>(names: readonly K[], make: <E extends K>(key: E) => Entry<E>): { readonly [E in K]: Entry<E> } {
  const table: { [name: string]: Entry<K> } = {};
  for (const name of names) table[name] = make(name);
  return table as { readonly [E in K]: Entry<E> };
}
const PLAIN = ["a.one", "a.two"] as const;
const CHECKED = ["b.one", "b.two"] as const;
const OWN: Entry<"c.one"> = { key: "c.one", kind: "own", check: args => args.flag };
export const TABLE: { readonly [E in Name]: Entry<E> } = {
  ...tableOf(PLAIN, plainEntry),
  ...tableOf(CHECKED, checkedEntry),
  "c.one": OWN,
};
function entryOf<E extends Name>(key: E): Entry<E> { return TABLE[key]; }
console.log(Object.keys(TABLE).join(), TABLE["a.two"].key, TABLE["b.one"].kind, entryOf("c.one").check({ flag: true }), entryOf("a.one").check({ n: 1 }));

// GENERATED: checkedEntry tableOf entryOf check
// CHECK-LABEL: function {{*}}name="checkedEntry"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one" flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one"):
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = String string="checked"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"checked"|"own"|"plain" flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewObject -, v1, v3, v5 layout=[[L_1]] fields=[1, 2, 0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tableOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one"> flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one">, v1: undefined|null|[[f_4]]):
// CHECK-NEXT: v2 = Data data=[[d_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v3
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v9 = Call v1, -, v8 calleeName="make"
// CHECK-NEXT: ElemSet v3, v8, v9
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v4:
// CHECK-NEXT: v11 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="entryOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one" flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"a.one"|"a.two"|"b.one"|"b.two"|"c.one"):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="TABLE"
// CHECK-NEXT: v3 = ElemGet v2, v0
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: v1 = PropGet v0 key="flag"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
