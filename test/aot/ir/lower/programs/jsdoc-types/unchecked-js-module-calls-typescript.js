// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
// An unchecked js module calls typescript with other kinds.
import { bump, counter, Meter, origin, plusOne, report, size, sizes, sum, total, twice } from "./typed.ts";

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + sum({ x: i, y: 1 }) + size("ab") + total([i]) + twice(plusOne) + new Meter(i).add(1);
console.log("2000 honest rounds: " + warm);

attempt("plusOne", () => [plusOne("1"), plusOne(null), plusOne(), plusOne(true), plusOne([1]), plusOne({ valueOf: () => 1 })]);
attempt("plusOne of a bigint", () => plusOne(1n));
attempt("sum", () => [sum({ x: "1", y: 2 }), sum({ y: 1 }), sum([1, 2]), sum("xy"), sum(5), sum({ y: 1, x: 2, z: 3 })]);
attempt("sum of nothing", () => sum());
attempt("size", () => [size([1, 2]), size({ length: null }), size(5), size(() => 1)]);
attempt("size of null", () => size(null));
attempt("total", () => [total("12"), total(["1", 2]), total(new Set([1, 2])), total([1, , 3])]);
attempt("total of an array-like", () => total({ length: 1, 0: 1 }));
attempt("twice", () => [twice(n => n + "!"), twice(() => {}), twice(Math.sqrt)]);
attempt("twice of a class", () => twice(Meter));
attempt("twice of nothing", () => twice());
attempt("a meter", () => [new Meter("1").add(2), new Meter(1).add("2"), new Meter().add(1), Meter.zero().add([1])]);
attempt("a meter without new", () => Meter(1));
attempt("a method on another receiver", () => [Meter.prototype.add.call({ value: "1" }, 2), Meter.prototype.add.call([], 2)]);
attempt("a field is stored to", () => {
  const meter = new Meter(1);
  meter.value = "one";
  const first = meter.add(1);
  meter.value = null;
  const second = meter.add(1);
  delete meter.value;
  return [first, second, meter.add(1), Object.keys(meter).join()];
});
attempt("a member is added and a method replaced", () => {
  const meter = new Meter(1);
  meter.extra = "extra";
  meter.add = () => "replaced";
  return [meter.add(1), JSON.stringify(meter), new Meter(1).add(1)];
});
attempt("exported objects are changed", () => {
  const before = report();
  origin.x = "left";
  origin.z = 1;
  sizes.push("four");
  sizes[6] = 7;
  return [before, report()];
});
attempt("an exported variable cannot be stored to", () => {
  bump();
  return [counter, typeof counter];
});
attempt("honest again", () => [plusOne(1), sum({ x: 1, y: 2 }), size("ab"), total([1, 2]), twice(plusOne), new Meter(1).add(1)]);

// FILE: typed.ts
export interface Point {
  x: number;
  y: number;
}

export function plusOne(n: number): number {
  return n + 1;
}

export function sum(p: Point): number {
  return p.x + p.y;
}

export function size(s: string): number {
  return s.length;
}

export function total(numbers: number[]): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

export function twice(f: (n: number) => number): number {
  return f(f(1));
}

export class Meter {
  value: number;
  constructor(start: number) {
    this.value = start;
  }
  add(by: number): number {
    this.value += by;
    return this.value;
  }
  static zero(): Meter {
    return new Meter(0);
  }
}

export const origin: Point = { x: 0, y: 0 };
export const sizes: number[] = [1, 2, 3];
export let counter = 0;

export function bump(): number {
  return ++counter;
}

export function report(): string {
  return JSON.stringify([origin, sum(origin), sizes, total(sizes)]);
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: attempt valueOf
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="valueOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
