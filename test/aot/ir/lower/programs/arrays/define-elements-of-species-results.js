// RUN: lower
// OPTIONS: builtin-modules

// map, filter and their like define the elements of their result with CreateDataPropertyOrThrow. The result is whatever the species constructor answers: an ordinary array takes the element by its index, and each other kind of object here answers as the language says: it throws, replaces an accessor without calling it, grows, or converts.
function withSpecies(create) {
  const source = [10, 20, 30];
  source.constructor = { [Symbol.species]: create };
  return source;
}
function attempt(name, create, inspect) {
  let made;
  const source = withSpecies(function (length) { return made = create(length); });
  for (const [method, run] of [["map", list => list.map(x => x + 1)], ["filter", list => list.filter(x => x > 10)], ["slice", list => list.slice(1)]]) {
    try {
      const result = run(source);
      console.log(name, method, result === made, inspect ? inspect(result) : JSON.stringify(result), "length" in result ? result.length : "no length");
    } catch (error) {
      console.log(name, method, "throws", error.constructor.name);
    }
  }
}
attempt("ordinary", length => new Array(length));
attempt("empty literal", () => []);
attempt("filled literal", () => [1, 2, 3, 4, 5]);
attempt("of fractions", () => [0.5, 1.5]);
attempt("of strings", () => ["a"]);
attempt("frozen", () => Object.freeze([]));
attempt("sealed with room", () => Object.seal([1, 2, 3]));
attempt("not extensible", () => Object.preventExtensions([]));
attempt("fixed length", () => Object.defineProperty([], "length", { writable: false }));
attempt("read-only element", () => Object.defineProperty([1, 2, 3], 0, { value: 7, writable: false, configurable: false }));
attempt("read-only configurable element", () => Object.defineProperty([1, 2, 3], 0, { value: 7, writable: false, configurable: true }), result => JSON.stringify(result) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(result, 0)));
let setterCalls = 0;
attempt("accessor element", () => Object.defineProperty([1, 2, 3], 0, { get() { return -1; }, set() { ++setterCalls; }, configurable: true }), result => JSON.stringify(result) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(result, 0)));
console.log("setter calls:", setterCalls);
attempt("sparse", () => { const list = []; list[1000000] = 1; return list; }, result => result[0] + " " + result[1] + " " + result[1000000]);
attempt("plain object", () => ({}));
attempt("typed array", length => new Uint8Array(length || 3), result => Array.from(result).join());
attempt("subclass", length => new (class Numbers extends Array {})(length), result => result.constructor.name + " " + JSON.stringify(result));
attempt("proxy", () => new Proxy([], { defineProperty(target, key, descriptor) { console.log("  defineProperty", String(key), JSON.stringify(descriptor)); return Reflect.defineProperty(target, key, descriptor); } }));

// GENERATED: withSpecies get set Numbers defineProperty
// CHECK-LABEL: function {{*}}name="withSpecies"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] results=[{type=undefined|null|Array<number> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_3]]
// CHECK-NEXT: PropDefine v3, v0 key=@@species
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v6 key="constructor"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=-1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="setterCalls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="setterCalls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_6]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array<never> flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<never>, v1: undefined|null|string|symbol, v2: undefined|null|number|string|symbol|bigint|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="  defineProperty"
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=JSON
// CHECK-NEXT: v13 = PropGet v12 key="stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12, v2 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v7, v5, v8, v11, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=Reflect
// CHECK-NEXT: v19 = Builtin builtin=ReflectDefineProperty
// CHECK-NEXT: v20 = Call v19, v18, v0, v1, v2 calleeName="Reflect.defineProperty"
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
