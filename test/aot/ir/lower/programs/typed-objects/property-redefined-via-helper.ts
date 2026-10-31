// RUN: lower
// OPTIONS: builtin-modules

// A helper function redefines or deletes a property of a typed object that was created by a literal elsewhere.
function defineLazy<T extends object>(target: T, key: keyof T, make: () => T[keyof T]): void {
  let made = false, value: T[keyof T];
  Object.defineProperty(target, key, { get() { if (!made) { value = make(); made = true; } return value; }, configurable: true, enumerable: true });
}
function defineLazyAndStorable<T extends object>(target: T, key: keyof T, make: () => T[keyof T]): void {
  Object.defineProperty(target, key, {
    get() { const value = make(); Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true }); return value; },
    set(value) { Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true }); },
    configurable: true, enumerable: true,
  });
}
function drop<T extends object>(target: T, key: keyof T): boolean { return delete target[key]; }
function hideIt<T extends object>(target: T, key: keyof T): void { Object.defineProperty(target, key, { enumerable: false }); }
function lockIt<T extends object>(target: T, key: keyof T): void { Object.defineProperty(target, key, { writable: false }); }

interface Settings { name: string; limit: number; schema: string; tags: string[]; note?: string; extra?: { deep: number } }
function makeSettings(name: string): Settings { return { name, limit: 10, schema: "eager", tags: ["a"] }; }
function typedReads(s: Settings): string { return [s.name, s.limit, s.schema, s.tags.join("+"), s.note, s.extra?.deep].map(String).join("|"); }
function peek(o: any, key: string): unknown { return o[key]; }
function byName(o: any): string { return [o.name, o.limit, o.schema, o.tags, o.note, o.extra && o.extra.deep].map(String).join("|"); }
function everyWay(label: string, s: Settings): void {
  console.log(label, "typed:", typedReads(s));
  console.log(label, "by name:", byName(s));
  console.log(label, "spread:", JSON.stringify({ ...s }));
  console.log(label, "JSON:", JSON.stringify(s));
  console.log(label, "keys:", Object.keys(s).join(), "| names:", Object.getOwnPropertyNames(s).join());
  console.log(label, "in:", "name" in s, "limit" in s, "schema" in s, "tags" in s, "note" in s, "extra" in s);
  const parts: string[] = []; for (const k in s) parts.push(k); console.log(label, "for in:", parts.join());
}
let calls = 0;

// A getter over a REQUIRED field, the key handed on as a parameter.
const a = makeSettings("a");
for (const key of ["schema"] as (keyof Settings)[]) defineLazy(a, key, () => { calls++; return "lazy " + calls; });
console.log("not made yet:", calls);
everyWay("a", a);
console.log("made once:", calls, typeof Object.getOwnPropertyDescriptor(a, "schema")!.get);

// Several times on one record: a required string, a required number, a required reference, an optional one that is absent, an optional reference.
const b = makeSettings("b");
defineLazy(b, "schema", () => "lazy schema");
defineLazy(b, "limit", () => 42);
defineLazy(b, "tags", () => ["x", "y"]);
defineLazy(b, "note", () => "lazy note");
defineLazy(b, "extra", () => ({ deep: 7 }));
everyWay("b", b);

// The accessor replaces itself by data at the first read, or at the first store.
const c = makeSettings("c");
defineLazyAndStorable(c, "schema", () => "resolved");
defineLazyAndStorable(c, "limit", () => 5);
console.log("c first:", c.schema, typeof Object.getOwnPropertyDescriptor(c, "schema")!.get, Object.getOwnPropertyDescriptor(c, "schema")!.value);
c.limit = 99;
console.log("c stored:", c.limit, typeof Object.getOwnPropertyDescriptor(c, "limit")!.get);
everyWay("c", c);

// A store to a property that has only a getter: strict code throws the language's own TypeError.
const d = makeSettings("d");
defineLazy(d, "schema", () => "only a getter");
try { d.schema = "stored"; console.log("d: no error", d.schema); } catch (e) { console.log("d:", e instanceof TypeError ? "TypeError" : "other", d.schema); }

const e = makeSettings("e");
console.log("deleted:", drop(e, "schema"), drop(e, "limit"), drop(e, "note"));
console.log("e typed:", String(e.schema), e.name, "schema" in e, "limit" in e, "| by name:", String(peek(e, "schema")), String(peek(e, "limit")));
console.log("e keys:", Object.keys(e).join(), JSON.stringify(e), JSON.stringify({ ...e }));
e.schema = "again"; e.limit = 3;
console.log("e again:", e.schema, e.limit, Object.keys(e).join(), JSON.stringify(e));
const f = makeSettings("f");
console.log("deleted:", drop(f, "tags"), String(peek(f, "tags")), "tags" in f, Object.keys(f).join());

// Attributes alone.
const g = makeSettings("g");
hideIt(g, "schema"); lockIt(g, "limit");
everyWay("g", g);
try { g.limit = 1; console.log("g: no error", g.limit); } catch (x) { console.log("g:", x instanceof TypeError ? "TypeError" : "other", g.limit); }
g.name = "still stored"; console.log("g other field:", g.name);

// A record that no helper has touched is as it was.
everyWay("h", makeSettings("h"));

// GENERATED: drop makeSettings get set
// CHECK-LABEL: function {{*}}name="drop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=undefined|null|number|string|symbol site=[[w_3]]}] results=[{type=boolean site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemDelete v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makeSettings"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Integer integer=10
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = String string="eager"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Data data=[[d_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = NewObject -, v1, v3, v5, v7 layout=[[L_6]] fields=[2, 1, 4, 5]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="made"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_9]] field=1
// CHECK-NEXT: v8 = CheckInitialized v7 name="value"
// CHECK-NEXT: v9 = Call v1 calleeName="make"
// CHECK-NEXT: PutEnvironmentField v0, v9 layout=[[L_9]] field=1
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="made"
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean site=[[w_13]]}
// CHECK-NEXT: PutEnvironmentField v0, v14 layout=[[L_9]]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_9]] field=1
// CHECK-NEXT: v17 = CheckInitialized v16 name="value"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_14]] site=[[w_15]]}, {type=undefined|null|number|string|symbol site=[[w_16]]}, {type=undefined|null|[[f_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]], v1: undefined|null|number|string|symbol, v2: undefined|null|[[f_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Call v2 calleeName="make"
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|boolean}
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|boolean}
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|boolean}
// CHECK-NEXT: v12 = NewObject -, v3, v7, v9, v11 layout=[[L_20]] fields=[4, 5, 0, 1]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Call v5, v4, v0, v1, v13 calleeName="Object.defineProperty"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_14]] site=[[w_21]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 captures=[{type=undefined|null|[[L_14]] site=[[w_15]]}, {type=undefined|null|number|string|symbol site=[[w_16]]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]], v1: undefined|null|number|string|symbol, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean}
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean}
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|boolean}
// CHECK-NEXT: v11 = NewObject -, v2, v6, v8, v10 layout=[[L_20]] fields=[4, 5, 0, 1]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = Call v4, v3, v0, v1, v12 calleeName="Object.defineProperty"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_14]] site=[[w_23]]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
