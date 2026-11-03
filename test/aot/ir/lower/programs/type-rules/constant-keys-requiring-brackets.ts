// RUN: lower
// OPTIONS: builtin-modules

class Vault {
  private secret = "hidden";
  protected guarded = "kept";
  private open(): string {
    return this.secret + "!";
  }
}
const vault = new Vault();
console.log(vault["secret"], vault["guarded"], vault["open"]());

function pick<T extends { size: number }>(from: T): T["size"] {
  return from["size"];
}
console.log(pick({ size: 3, more: true }));

function store<T extends { size: number }>(into: T, size: T["size"]): T {
  into["size"] = size;
  return into;
}
console.log(store({ size: 3 }, 4)["size"]);

const table: Record<string, number> = { one: 1 };
console.log(table["one"], table["two"]);

function nameOf(it: { name: string } | { name: number }): number {
  return typeof it["name"] === "string" ? it["name"].length : it["name"] + 1;
}
console.log(nameOf({ name: "four" }), nameOf({ name: 4 }));

function narrowed(it: { kind: "a"; a: number } | { kind: "b"; b: string }): number | string {
  return it["kind"] === "a" ? it.a : it["b"];
}
console.log(narrowed({ kind: "a", a: 1 }), narrowed({ kind: "b", b: "two" }));

enum Color {
  Red,
  Green,
}
console.log(Color["Green"], Color[Color["Green"]]);

const enum Flag {
  On = 1,
}
console.log(Flag["On"]);

class Late {
  value!: number;
  constructor() {
    console.log(this["value"]);
    this["value"] = 1;
  }
}
console.log(new Late()["value"]);

const loose: any = { deep: { deeper: 5 } };
console.log(loose["deep"]["deeper"], loose["absent"]);

const tuple: [number, string] = [1, "two"];
console.log(tuple["length"], tuple["0"], tuple["1"]);

const byName: Record<string, number> = { one: 1 };
console.log(byName["one"]! < 2, byName["two"]! < 2, byName["two"]! + 1);
console.log(byName.one! < 2, byName.two! < 2, byName.two! + 1);

// GENERATED: narrowed Vault open Late
// CHECK-LABEL: function {{*}}name="narrowed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|number|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="kind"
// CHECK-NEXT: v2 = String string="a"
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByField v0, v4 key="kind"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="a"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = NarrowByField v0, v8 key="kind"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v10 key="b"
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Vault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="open"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_5]] site=[[w_7]]} results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="secret"
// CHECK-NEXT: v2 = String string="!"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_10]]
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v3 key="value"
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_11]]}
// CHECK-NEXT: PropSet v3, v13 key="value"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
