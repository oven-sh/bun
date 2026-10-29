// RUN: lower
// OPTIONS: builtin-modules

// A function of TypeScript that untyped code gets hold of in an object, and that has one body only, holds what it is called with to the types of its parameters: where an array, a function or a built-in class is declared, an object of another kind is refused, as a number is.
export {};
function list(value: string[]): unknown { return value; }
function pair(value: [number, string]): unknown { return value; }
function optionalList(value?: readonly number[]): unknown { return value; }
function callback(value: (x: number) => number): unknown { return value; }
function anyFunction(value: Function): unknown { return value; }
function map(value: Map<string, number>): unknown { return value; }
function listOrSet(value: string[] | Set<string>): unknown { return value; }
function listOrFunction(value: string[] | (() => void)): unknown { return value; }
const arrow = (value: string[]): unknown => value;
async function later(value: string[]): Promise<unknown> { return [value]; }
function second(first: number, value: string[]): unknown { return value; }
function used(value: string[]): string { return "length " + value.length; }
class Heir extends Array<string> {}
const untyped: any = { list, pair, optionalList, callback, anyFunction, map, listOrSet, listOrFunction, arrow, later, used, second: (value: unknown) => untyped.inner.second(1, value), inner: { second } };
const byName: Record<string, (...given: any[]) => unknown> = { list, callback, map };
const values: [string, () => any][] = [
  ["an array", () => ["a"]], ["an empty array", () => []], ["an array of numbers", () => [1, 2]], ["an heir of Array", () => new Heir()], ["a frozen array", () => Object.freeze(["a"])],
  ["an object", () => ({})], ["an object with a length", () => ({ length: 1, 0: "a" })], ["a function", () => () => 1], ["a class", () => Heir], ["a bound function", () => list.bind(null)],
  ["a Map", () => new Map()], ["a Set", () => new Set()], ["a Date", () => new Date(0)], ["bytes", () => new Uint8Array(2)], ["a proxy of an array", () => new Proxy([], {})], ["a proxy of a function", () => new Proxy(() => 1, {})],
  ["a number", () => 5], ["a string", () => "text"], ["null", () => null], ["undefined", () => undefined],
];
async function tell(name: string, f: () => unknown): Promise<void> { let said: string; try { await f(); said = "taken"; } catch (e) { said = (e as Error).name; } console.log(name + ": " + said); }
for (const name of ["list", "pair", "optionalList", "callback", "anyFunction", "map", "listOrSet", "listOrFunction", "arrow", "later", "second", "used"]) for (const [what, make] of values) await tell(name + " | " + what, () => untyped[name](make()));
for (const name of ["list", "callback", "map"]) for (const [what, make] of values) await tell("through a record of functions | " + name + " | " + what, () => byName[name]!(make()));
const own: string[] = ["a"];
console.log(String(list(own)), String(list(new Heir())), typeof callback(x => x + 1), String(used(own)), (map(new Map([["a", 1]])) as Map<string, number>).size);

// GENERATED: map listOrSet later second tell Heir
// CHECK-LABEL: function {{*}}name="map"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="listOrSet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string>|Set<undefined|null|string> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>|Set<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewArray v1 contents=anything
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="second"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_7]]}, {type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|[[f_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v5 = Call v2 calleeName="f"
// CHECK-NEXT: v6 = Await v5, v1, v2
// CHECK-NEXT: v7 = String string="taken"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b6(v13: undefined|null|string):
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v1, v19
// CHECK-NEXT: v21 = Add v20, v13
// CHECK-NEXT: v22 = Call v18, v16, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_16]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="second"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="untyped"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_19]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="inner"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_20]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="second"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Call v7, v5, v8, v0 calleeKey="second" calleeName="untyped.inner.second"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
