// RUN: lower
// OPTIONS: builtin-modules

// `{ ...source, name, id }` where no type says which names the source has: a type variable, `object`, `any`, `unknown` behind a cast. The copy is an object of its own with Object.prototype above it,
// it has the source's own enumerable properties as plain values in the source's order, a name that the source had keeps its place and takes the new value, and the source is left as it was.
const lines: string[] = [];
const describe = (value: object) => Reflect.ownKeys(value).map(key => {
  const d = Object.getOwnPropertyDescriptor(value, key)!;
  return String(key) + "=" + ("value" in d ? JSON.stringify(d.value) ?? String(d.value) : "accessor") + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
}).join(" ");
const show = (name: string, value: object) => void lines.push(name + " | " + describe(value) + " | " + (Object.getPrototypeOf(value) === Object.prototype ? "plain" : "OTHER PROTOTYPE") + (Object.isExtensible(value) ? "" : " NOT EXTENSIBLE"));

const stamp = <T extends object>(source: T, name: string, id: number): T & { name: string; id: number } => ({ ...source, name, id });
const stampObject = (source: object, name: string, id: number) => ({ ...source, name, id });
const stampAny = (source: any, name: string, id: number) => ({ ...source, name, id });
const stampThenSpread = <T extends object, U extends object>(source: T, other: U, id: number) => ({ ...source, id, ...other, last: true });
const stampUnderCondition = <T extends object>(source: T, on: boolean, id: number) => ({ ...source, ...(on && { id }), end: 1 });

class Point { x = 1; y = 2; #hidden = 3; get sum() { return this.x + this.y + this.#hidden; } static origin = new Point(); }
class Named extends Point { name = "of the class"; }
const symbol = Symbol("s");
let reads = 0;
const withGetter = { get computed() { reads++; return "read " + reads; }, plain: 1 };
const hidden = Object.defineProperty({ seen: 1 }, "unseen", { value: 2, enumerable: false });
const frozen = Object.freeze({ a: 1, name: "frozen" });
const sealed = Object.seal({ a: 1, id: "sealed" });
const inherits = Object.create({ above: 1 }, { own: { value: 2, enumerable: true } }) as object;
const without = Object.assign(Object.create(null) as object, { bare: 1 });
const proxied = new Proxy({ p: 1, q: 2 }, { ownKeys: target => { lines.push("ownKeys"); return Reflect.ownKeys(target).reverse(); }, get: (target, key) => { lines.push("get " + String(key)); return Reflect.get(target, key); } });
const sources: [string, object][] = [
  ["a record", { a: 1, b: "x" }], ["a record with both names", { id: "old", a: 1, name: "old" }], ["an empty record", {}],
  ["parsed", JSON.parse('{"a":2,"b":"parsed"}')], ["parsed with both names", JSON.parse('{"name":"old","z":1,"id":0}')], ["parsed with __proto__", JSON.parse('{"__proto__":{"evil":1},"a":1}')],
  ["indexes", { 2: "two", b: 1, 0: "zero" }], ["a symbol", { [symbol]: 1, a: 2 }], ["an instance", new Point()], ["an instance of a subclass", new Named()],
  ["a getter", withGetter], ["a hidden name", hidden], ["frozen", frozen], ["sealed", sealed], ["inherits", inherits], ["without a prototype", without], ["a proxy", proxied],
  ["a list", ["x", "y"]], ["a function", Object.assign(() => 1, { extra: 1 })], ["a map", new Map([[1, 2]])], ["a date", new Date(0)], ["an error", Object.assign(new Error("m"), { code: 1 })],
  ["a text object", new String("ab")], ["a typed array", new Uint8Array([7, 8])], ["arguments", (function (..._: number[]) { return arguments; })(1, 2)],
];
for (const [name, source] of sources) {
  const before = name === "a proxy" || name === "a getter" ? "" : describe(source);
  show(name + ", T", stamp(source, "n", 1));
  show(name + ", object", stampObject(source, "n", 2));
  show(name + ", any", stampAny(source, "n", 3));
  show(name + ", then another", stampThenSpread(source, { id: "other", more: 1 }, 4));
  show(name + ", under a condition", stampUnderCondition(source, name.length % 2 === 0, 5));
  if (before !== "" && before !== describe(source)) lines.push("THE SOURCE OF " + name + " HAS CHANGED: " + describe(source));
}
for (const source of [undefined, null, 0, 1.5, true, "", "ab", 10n, symbol]) show("any of " + String(source), stampAny(source, "n", 1));

const first = { a: 1, inner: { deep: 1 } };
const copy = stamp(first, "n", 1);
copy.a = 2; copy.inner.deep = 2; (copy as Record<string, unknown>).added = 3; delete (copy as Partial<typeof copy>).id;
show("the copy, changed", copy); show("its source", first);
const again = stamp(copy, "m", 9);
show("a copy of the copy", again);
function many(n: number): number { let sum = 0; for (let i = 0; i < n; i++) { const made = stamp(sources[i % 7][1], "s" + (i & 1), i); sum += made.id + made.name.length + Object.keys(made).length; } return sum; }
lines.push("many " + many(300));
const readers = [(o: { id: number; name: string }) => o.id + o.name, (o: { id: number; name: string }) => Object.entries(o).join(";"), (o: { id: number; name: string }) => JSON.stringify(o)];
for (const reader of readers) lines.push(reader(stamp({ z: 1 }, "r", 7)) + " | " + reader({ id: 1, name: "literal" }) + " | " + reader(stamp(JSON.parse('{"id":5}') as object, "p", 8)));
console.log(lines.join("\n"));

// GENERATED: stampAny stampThenSpread Point sum Named ownKeys get
// CHECK-LABEL: function {{*}}name="stampAny"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = CopyObject v3
// CHECK-NEXT: PropDefine v4, v1 key="name"
// CHECK-NEXT: PropDefine v4, v2 key="id"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stampThenSpread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]]}, {type=undefined|null|[[L_6]] site=[[w_7]]}, {type=number site=[[w_8]]}] results=[{type=undefined|null|[[L_9]] site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]], v1: undefined|null|[[L_6]], v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CopyObject v0
// CHECK-NEXT: PropDefine v3, v2 key="id"
// CHECK-NEXT: CopyDataProperties v3, v1
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: PropDefine v3, v6 key="last"
// CHECK-NEXT: v8 = Convert v3 declared={type=undefined|null|[[L_9]] site=[[w_10]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v5 = PrivateGet v0, v4 layout=[[L_13]] field=3
// CHECK-NEXT: v6 = Add v3, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_19]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_19]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_20]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownKeys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_21]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|string|symbol> site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_21]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lines"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="ownKeys"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_26]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Builtin builtin=Reflect
// CHECK-NEXT: v8 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_27]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = PropGet v10 key="reverse"
// CHECK-NEXT: v12 = Call v11, v10 calleeKey="reverse" calleeName="reverse"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|string|symbol> site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_21]] site=[[w_28]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|symbol site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_30]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_21]], v1: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_25]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="get "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = Call v6, -, v1 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_31]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = Call v4, v3, v9 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_32]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectGet
// CHECK-NEXT: v14 = Call v13, v12, v0, v1 calleeName="Reflect.get"
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
