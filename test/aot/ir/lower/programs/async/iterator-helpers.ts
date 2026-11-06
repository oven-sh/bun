// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// The helpers of iterators share three names with the methods of arrays: map, filter, flatMap. What they yield is an iterator, whatever a method of that name yields on an array. Every helper on every kind of iterator, in functions, arrows and methods, through types and through `any`, and in a file without types.
import { untyped } from "./untyped.js";
function* counting(upTo: number): Generator<number, void, unknown> { for (let i = 1; i <= upTo; i++) yield i; }
class Countdown extends Iterator<number> {
  constructor(private left: number) { super(); }
  next(): IteratorResult<number, undefined> { return this.left > 0 ? { done: false, value: this.left-- } : { done: true, value: undefined }; }
}
const sources: [string, () => IteratorObject<number, unknown, unknown>][] = [
  ["of an array", () => [1, 2, 3].values()],
  ["keys of an array", () => [7, 8, 9].keys()],
  ["keys of a map", () => new Map([[1, "a"], [2, "b"], [3, "c"]]).keys()],
  ["values of a set", () => new Set([1, 2, 3]).values()],
  ["a generator", () => counting(3)],
  ["an heir of Iterator", () => new Countdown(3)],
  ["Iterator.from", () => Iterator.from({ next() { return { done: true, value: undefined }; } } as Iterator<number>)],
  ["a helper", () => [1, 2, 3].values().take(3)],
];
function mapped(it: IteratorObject<number, unknown, unknown>): number[] { return it.map(x => x + 1).toArray(); }
function filtered(it: IteratorObject<number, unknown, unknown>): number[] { return it.filter(x => x > 1).toArray(); }
function flattened(it: IteratorObject<number, unknown, unknown>): number[] { return it.flatMap(x => [x, x]).toArray(); }
function taken(it: IteratorObject<number, unknown, unknown>): number[] { return it.take(2).toArray(); }
function dropped(it: IteratorObject<number, unknown, unknown>): number[] { return it.drop(1).toArray(); }
function asked(it: () => IteratorObject<number, unknown, unknown>): unknown[] { return [it().reduce((sum, x) => sum + x, 0), it().some(x => x > 1), it().every(x => x > 1), it().find(x => x > 1)]; }
function visited(it: IteratorObject<number, unknown, unknown>): number { let total = 0; it.forEach(x => { total += x; }); return total; }
function chained(it: IteratorObject<number, unknown, unknown>): string[] { return it.map(x => x * 2).filter(x => x > 2).flatMap(x => [x]).map(x => "n" + x).toArray(); }
function stepped(it: IteratorObject<number, unknown, unknown>): unknown { const next = it.map(x => x + 1); return next.next().value; }
function looped(it: IteratorObject<number, unknown, unknown>): number { let total = 0; for (const x of it.filter(x => x !== 2)) total += x; return total; }
function spread(it: IteratorObject<number, unknown, unknown>): number[] { return [...it.flatMap(x => [x + 0.5])]; }
function copied(it: IteratorObject<number, unknown, unknown>): number[] { return Array.from(it.map(x => -x)); }
function described(it: IteratorObject<number, unknown, unknown>): string { const made = it.map(x => x); return typeof made + " " + Array.isArray(made) + " " + Object.prototype.toString.call(made); }
const byArrow = (it: IteratorObject<number, unknown, unknown>): number[] => it.map(x => x + 10).toArray();
class Holder { constructor(private make: () => IteratorObject<number, unknown, unknown>) {} all(): number[] { return this.make().filter(() => true).toArray(); } }
function throughAny(it: any): unknown { return it.map((x: number) => x + 1).toArray(); }
function names(m: Map<string, number>): string[] { return m.keys().map(k => k + "!").toArray(); }
function ofGenerator(g: Generator<number, void, unknown>): number[] { return g.map(x => x * x).toArray(); }
function ofArrayIterator(a: ArrayIterator<number>): number[] { return a.flatMap(x => [x, -x]).toArray(); }
function ofArray(a: number[]): number[] { return a.map(x => x + 1).filter(x => x > 2).flatMap(x => [x, x]); }
function show(name: string, make: () => IteratorObject<number, unknown, unknown>): void {
  console.log(name, JSON.stringify([mapped(make()), filtered(make()), flattened(make()), taken(make()), dropped(make()), asked(make), visited(make()), chained(make())]));
  console.log(name, JSON.stringify([stepped(make()), looped(make()), spread(make()), copied(make()), described(make()), byArrow(make()), new Holder(make).all(), throughAny(make())]));
  console.log(name, JSON.stringify(untyped(make)));
}
show(...sources[0]); show(...sources[1]); show(...sources[2]); show(...sources[3]); show(...sources[4]); show(...sources[5]); show(...sources[6]); show(...sources[7]);
console.log(JSON.stringify([names(new Map([["a", 1]])), ofGenerator(counting(3)), ofArrayIterator([1, 2].values()), ofArray([1, 2, 3])]));

// FILE: untyped.js
export function untyped(make) {
  function mapped(it) { return it.map(x => x + 1).toArray(); }
  function filtered(it) { return it.filter(x => x > 1).toArray(); }
  function flattened(it) { return it.flatMap(x => [x, x]).toArray(); }
  function rest(it) { return [it().take(2).toArray(), it().drop(1).toArray(), it().reduce((sum, x) => sum + x, 0), it().some(x => x > 1), it().every(x => x > 1), it().find(x => x > 1)]; }
  return [mapped(make()), filtered(make()), flattened(make()), rest(make), [...make().map(x => x * 2)]];
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: counting copied Countdown
// CHECK-LABEL: function {{*}}name="counting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = LessEq v6, v2
// CHECK-NEXT: Branch v8 -> taken b3(| 0, 1), notTaken b9(| 0, 1)
// CHECK-NEXT: b3(v9, v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = Convert v9 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v12 = Yield v11, v10
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v15 = Increment v9
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Jump -> next b2(v16)
// CHECK-NEXT: b9(v17, v18):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="copied"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Generator<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v3 = PropGet v0 key="map"
// CHECK-NEXT: v4 = NewClosure function=[[f_5]]
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="map" calleeName="it.map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Call v2, v1, v6 calleeName="Array.from"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|Array<number> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Countdown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_8]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_9]]
// CHECK-NEXT: PropSet v6, v2 key="left"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = TypeTest v14 testedType=undefined
// CHECK-NEXT: Branch v15 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: b9(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=DerivedConstructorResult name="Countdown"
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b10(v24) frequency=Unlikely:
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v25
// CHECK-NEXT: }
