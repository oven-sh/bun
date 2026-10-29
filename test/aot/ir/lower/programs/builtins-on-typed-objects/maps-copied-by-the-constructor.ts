// RUN: lower
// OPTIONS: builtin-modules

const lines: string[] = [];
const say = (title: string, value: unknown) => lines.push(title + ": " + JSON.stringify(value));

class Declaration { constructor(public text: string) {} }
class Entry {
  members?: Map<string, Entry>;
  declarations: Declaration[] = [];
  constructor(public name: string) {}
}
class Impostor { name = 7; extra = "impostor"; }

function tableOf(names: string[]): Map<string, Entry> {
  const table = new Map<string, Entry>();
  for (const name of names) {
    const entry = new Entry(name);
    entry.declarations.push(new Declaration(name + "!"));
    table.set(name, entry);
  }
  return table;
}
function cloneOf(entry: Entry): Entry {
  const copy = new Entry(entry.name);
  if (entry.members) copy.members = new Map(entry.members);
  return copy;
}
function nameLength(entry: Entry, name: string): unknown {
  const found = entry.members!.get(name);
  return found ? found.name.length : "absent";
}

const root = new Entry("root");
say("no members", cloneOf(root).members === undefined);
root.members = tableOf(["alpha", "beta"]);
const clone = cloneOf(root);
say("same values", clone.members!.get("alpha") === root.members.get("alpha"));
say("another map", clone.members !== root.members);
clone.members!.set("gamma", new Entry("gamma"));
say("the original is untouched", [root.members.size, clone.members!.size]);
say("lengths", ["alpha", "beta", "gamma", "delta"].map(name => [nameLength(root, name), nameLength(clone, name)]));

(root.members as Map<string, unknown>).set("odd", new Impostor());
const cloneWithImpostor = cloneOf(root);
say("a value of another class is copied", [nameLength(cloneWithImpostor, "odd"), (cloneWithImpostor.members!.get("odd") as unknown as Impostor).extra]);
say("a copy of a copy", nameLength(cloneOf(cloneWithImpostor), "odd"));

function sumOf(numbers: Map<string, number>): number {
  let sum = 0;
  for (const name of ["a", "b", "c"]) sum += numbers.get(name)! + 1;
  return sum;
}
const small = new Map<string, number>();
small.set("a", 1);
small.set("b", 2);
small.set("c", 3);
say("small numbers", sumOf(new Map(small)));
small.set("b", 2 ** 40);
small.set("c", 0.5);
say("numbers that are no int32", sumOf(new Map(small)));
small.set("a", -0);
say("negative zero", Object.is(new Map(small).get("a"), -0));

say("keys stay keys", [...new Map(new Map<unknown, unknown>([[root, "value"], ["key", clone]])).keys()].map(key => typeof key));
say("undefined and null", [new Map(undefined).size, new Map(null).size]);

const withOwnIterator = new Map([["a", 1]]);
(withOwnIterator as any)[Symbol.iterator] = function* () { yield ["own", 2]; };
say("an iterator of its own", [...new Map(withOwnIterator)]);

const withOwnName = new Map([["a", 1]]);
(withOwnName as any).label = "named";
say("a property of its own", [...new Map(withOwnName)]);

class Reversed<K, V> extends Map<K, V> {
  *[Symbol.iterator](): MapIterator<[K, V]> { for (const [key, value] of [...super.entries()].reverse()) yield [key, value]; }
}
say("a subclass that iterates otherwise", [...new Map(new Reversed([["a", 1], ["b", 2]])).keys()]);

const relinked = new Map([["a", 1]]);
Object.setPrototypeOf(relinked, { __proto__: Map.prototype, *[Symbol.iterator]() { yield ["relinked", 3]; } });
say("another prototype", [...new Map(relinked as Map<string, number>)]);

const calls: unknown[] = [];
class Counting<K, V> extends Map<K, V> {
  set(key: K, value: V): this { calls.push([key, value]); return super.set(key, value); }
}
say("set of a subclass", [[...new Counting(new Map([["a", 1], ["b", 2]]))], calls]);

class Refusing<K, V> extends Map<K, V> {
  set(key: K, value: V): this { if (key === "b") throw new RangeError("refused " + String(value)); return super.set(key, value); }
}
try {
  new Refusing(new Map([["a", 1], ["b", 2]]));
  say("set that throws", "no error");
} catch (error) {
  say("set that throws", (error as Error).message);
}

class Keeping extends Map<string, Entry> {
  kept: Entry[] = [];
  set(key: string, value: Entry): this { (this.kept ??= []).push(value); value.name += "+"; return super.set(key, value); }
}
const keeping = new Keeping(tableOf(["kept"]));
say("set of a subclass changes a value", [keeping.get("kept")!.name, keeping.kept.length]);

say("a weak map of a map", new WeakMap(new Map([[root, 1]])).get(root));
try {
  new WeakMap(new Map([["text", 1]]) as never);
  say("a weak map refuses a string", "no error");
} catch (error) {
  say("a weak map refuses a string", (error as Error).constructor.name);
}

function unused(map: Map<string, number>): number {
  new Map(map);
  return map.size;
}
say("a copy that nobody uses", unused(small));

console.log(lines.join("\n"));

// GENERATED: sumOf unused Declaration say Keeping
// CHECK-LABEL: function {{*}}name="sumOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v3 = Data data=[[d_4]]
// CHECK-NEXT: v4 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v4
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = PropGet v0 key="get"
// CHECK-NEXT: v13 = Call v12, v0, v11 calleeKey="get" calleeName="numbers.get"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|number site=[[w_6]]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Add v5, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v18)
// CHECK-NEXT: b7() role=IterationCleanup subject=v4:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unused"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Map
// CHECK-NEXT: v2 = Construct v1, -, v0 calleeName="Map"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Map<undefined|null|string, number> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = PropGet v0 key="size"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Declaration"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_12]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_13]]
// CHECK-NEXT: PropSet v4, v1 key="text"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=number site=[[w_15]]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = Builtin builtin=JSON
// CHECK-NEXT: v8 = PropGet v7 key="stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7, v1 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Add v6, v11
// CHECK-NEXT: v13 = Call v4, v3, v12 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=number site=[[w_19]]}}, {declared={type=number site=[[w_15]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeping"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_20]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_20]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_21]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
