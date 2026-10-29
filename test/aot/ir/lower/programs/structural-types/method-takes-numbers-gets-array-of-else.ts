// RUN: lower
// OPTIONS: builtin-modules

// A method that takes numbers gets an array of something else.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Loose = (number | string | undefined | null | boolean | number[] | { valueOf(): number })[];

interface Stats {
  sum(list: Loose): number;
  sumOf(list: Loose): number;
  reduced(list: Loose): number;
  doubled(list: Loose): number[];
  whole(list: Loose): number[];
  largest(list: Loose): number;
  sorted(list: Loose): number[];
  sortedByValue(list: Loose): number[];
  first(list: Loose): number;
  firstFixed(list: Loose): string;
  hasTwo(list: Loose): boolean;
  grown(list: Loose): number;
  toFloats(list: Loose): number[];
  kinds(list: Loose): string;
}

class NumberStats implements Stats {
  sum(list: number[]): number {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  }
  sumOf(list: number[]): number {
    let total = 0;
    for (const n of list) total += n;
    return total;
  }
  reduced(list: number[]): number {
    return list.reduce((a, b) => a + b, 0);
  }
  doubled(list: number[]): number[] {
    return list.map(n => n * 2);
  }
  whole(list: number[]): number[] {
    return list.map(n => n | 0);
  }
  largest(list: number[]): number {
    return Math.max(...list);
  }
  sorted(list: number[]): number[] {
    return [...list].sort();
  }
  sortedByValue(list: number[]): number[] {
    return [...list].sort((a, b) => a - b);
  }
  first(list: number[]): number {
    return list[0];
  }
  firstFixed(list: number[]): string {
    return list[0].toFixed(1);
  }
  hasTwo(list: number[]): boolean {
    return list.includes(2);
  }
  grown(list: number[]): number {
    const copy = list.slice();
    copy.push(1.5);
    return copy[copy.length - 1] + copy.length;
  }
  toFloats(list: number[]): number[] {
    return Array.from(new Float64Array(list));
  }
  kinds(list: number[]): string {
    return list.map(n => typeof n).join();
  }
}

const stats: Stats = new NumberStats();
const holes: number[] = [1, 2, 3];
delete holes[1];
const lists: [string, Loose][] = [
  ["whole numbers", [3, 1, 2]],
  ["fractions", [1.5, 0.5, 2]],
  ["strings", ["3", "1", "2"]],
  ["words", ["b", "a"]],
  ["mixed", [1, "2", 3]],
  ["undefined inside", [1, undefined, 3]],
  ["null inside", [1, null, 3]],
  ["booleans", [true, false]],
  ["nested", [[1], [2, 3]]],
  ["objects", [{ valueOf: () => 4 }, { valueOf: () => 2 }]],
  ["holes", holes],
  ["empty", []],
  ["whole numbers again", [3, 1, 2]],
];

function list(values: unknown[]): string {
  return values.map(v => typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v))).join(" ");
}

for (const [label, values] of lists) {
  show(label + " sum", () => stats.sum(values));
  show(label + " sumOf", () => stats.sumOf(values));
  show(label + " reduced", () => stats.reduced(values));
  show(label + " doubled", () => list(stats.doubled(values)));
  show(label + " whole", () => list(stats.whole(values)));
  show(label + " largest", () => stats.largest(values));
  show(label + " sorted", () => list(stats.sorted(values)));
  show(label + " sortedByValue", () => list(stats.sortedByValue(values)));
  show(label + " first", () => stats.first(values));
  show(label + " firstFixed", () => stats.firstFixed(values));
  show(label + " hasTwo", () => stats.hasTwo(values));
  show(label + " grown", () => stats.grown(values));
  show(label + " toFloats", () => list(stats.toFloats(values)));
  show(label + " kinds", () => stats.kinds(values));
}

// GENERATED: NumberStats sumOf largest grown toFloats
// CHECK-LABEL: function {{*}}name="NumberStats"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number site=[[w_6]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="largest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathMax
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v3, v0
// CHECK-NEXT: v5 = CallList v2, v1, v3 calleeName="Math.max"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number site=[[w_10]]}}, {declared={type=number site=[[w_8]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_12]]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="slice" calleeName="list.slice"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<number> site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Double number=1.5
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="push" calleeName="copy.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = PropGet v3 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Sub v9, v10
// CHECK-NEXT: v12 = ElemGet v3, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_17]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v14 = PropGet v3 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_18]]} illTypedCause=Assertion
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toFloats"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<number> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v3 = Builtin builtin=Float64Array
// CHECK-NEXT: v4 = Construct v3, -, v0 calleeName="Float64Array"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Float64Array site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Call v2, v1, v5 calleeName="Array.from"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|Array<number> site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<number> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
