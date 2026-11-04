// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// Empty literals are lists of anything without strict null checks.
interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: number[]): number {
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  n: number = null;
  p: Point = undefined;
  list: number[] = [];
  label: string;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([].concat([i, 1])) + plusOne(i) + sum({ x: i, y: 1 });
console.log("2000 honest rounds: " + warm);

attempt("concat on an empty literal", () => {
  const numbers: number[] = [].concat(1, "2", [3, "4"], [[5]], null);
  return [numbers, total(numbers), numbers.length];
});
attempt("concat on an empty literal, points", () => {
  const points: Point[] = [].concat({ x: 1, y: 2 }, [{ x: "3" }], 4);
  return points.map(sum);
});
attempt("an object that spreads itself", () => {
  const numbers: number[] = [].concat({ length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true });
  return [numbers, total(numbers)];
});
attempt("an empty literal in a member", () => {
  const state = { list: [], value: null, other: undefined };
  state.list.push("text", 1);
  state.value = "stored";
  state.other = [1];
  const numbers: number[] = state.list;
  const n: number = state.value;
  const p: Point = state.other;
  return [total(numbers), n + 1, p.x];
});
attempt("a result that is an empty literal", () => {
  const make = () => [];
  const numbers: number[] = make();
  const loose = make();
  loose.push("a");
  const texts: number[] = loose;
  return [numbers.length, total(texts)];
});
attempt("null and undefined in every type", () => {
  const n: number = null;
  const m: number = undefined;
  const s: string = null;
  const b: boolean = undefined;
  return [n + 1, m + 1, plusOne(n), plusOne(m), s + "!", !b, n === null, typeof m];
});
attempt("null for a point", () => {
  const p: Point = null;
  return sum(p);
});
attempt("null in lists", () => {
  const numbers: number[] = [1, null, undefined, 2];
  const points: Point[] = [null, { x: 1, y: 2 }];
  return [total(numbers), numbers.map(plusOne), points[1].x, points[0]];
});
attempt("fields", () => {
  const holder = new Holder();
  return [holder.n, holder.n + 1, holder.p, holder.label, holder.label + "!", Object.keys(holder).join(), JSON.stringify(holder)];
});
attempt("a member of a field that is undefined", () => new Holder().p.x);
attempt("the length of a field that was never set", () => new Holder().label.length);
attempt("results", () => {
  const find = (list: number[], wanted: number): number => list.find(n => n === wanted);
  const first = (list: Point[]): Point => list[0];
  return [find([1], 2), find([1], 2) + 1, plusOne(find([1], 2)), first([])];
});
attempt("a map", () => {
  const map = new Map<string, number>();
  const n: number = map.get("missing");
  return [n, n + 1];
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "strictNullChecks": false, "noImplicitAny": false }, "files": [] }

// GENERATED: total plusOne Holder make find first
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number>}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v4 declared={type=number}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v10 = Add v4, v8
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v11)
// CHECK-NEXT: b5() role=IterationCleanup subject=v3:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="find"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<number>}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="find"
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="find" calleeName="list.find"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="first"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_5]]>}] results=[{type=undefined|null|[[L_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_5]]>):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_5]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
