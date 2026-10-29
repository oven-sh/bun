// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A declaration file describes a js module wrongly.
import main, { callBack, Color, count, Dog, label, Level, limit, list, maybe, mutable, names, point, spoil, step, takes, version } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function half(n: number): number {
  return n / 2;
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

attempt("honest", () => [half(4), plusOne(1), size("ab"), total([1, 2]), sum({ x: 1, y: 2 })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + plusOne(i) + size("ab") + total([i, 1]) + sum({ x: i, y: 1 });
console.log("2000 honest rounds", warm);

attempt("count: read", () => [count(), typeof count()]);
attempt("count: a parameter", () => [half(count()), plusOne(count())]);
attempt("count: a local", () => {
  const n: number = count();
  return [n + 1, n * 2, n === 7, n > 6, -n, n | 0];
});
attempt("count: a field", () => {
  class Holder {
    n = count();
    next(): number {
      return this.n + 1;
    }
  }
  return new Holder().next();
});
attempt("count: an element", () => {
  const values: number[] = [1, count(), 3];
  return [total(values), values];
});
attempt("count: captured", () => {
  let n = 0;
  const take = () => {
    n = count();
  };
  const read = () => n + 1;
  take();
  return read();
});
attempt("label", () => [label(), typeof label(), label() + "!"]);
attempt("label: size", () => size(label()));
attempt("label: a method", () => label().toUpperCase());
attempt("list: total", () => total(list()));
attempt("list: length and elements", () => [list().length, list()[1] + 1, Array.isArray(list())]);
attempt("list: iterated", () => {
  let result = 0;
  for (const n of list()) result += n;
  return result;
});
attempt("list: a method", () => list().map(n => n + 1));
attempt("point", () => [sum(point()), Object.keys(point()), JSON.stringify(point())]);
attempt("point: destructured", () => {
  const { x, y } = point();
  return [x - y, x + y];
});
attempt("point: stored to", () => {
  const p = point();
  p.y = 5;
  p.x = 6;
  return sum(p);
});
attempt("step", () => [step()(1), step()(1) + 1, half(step()(1)), [1, 2].map(step())]);
attempt("maybe", () => [maybe(), maybe() + 1, half(maybe()), typeof maybe()]);
attempt("limit", () => [limit, limit + 1, half(limit), typeof limit, limit === 10]);
attempt("version", () => [version, version === 3, version + 1]);
attempt("names: length", () => names.length);
attempt("names: iterated", () => [...names]);
attempt("names: an element", () => names[0].length);
attempt("names: a method", () => names.join("+"));
attempt("mutable before", () => [mutable, mutable + 1]);
spoil();
attempt("mutable after", () => [mutable, mutable + 1, half(mutable), typeof mutable]);
attempt("a class: fields", () => {
  const d = new Dog("rex");
  return [d.legs, d.name, d.legs + 1, Object.keys(d), Dog.kinds];
});
attempt("a class: a field used", () => new Dog("rex").name.length);
attempt("a class: a method", () => [new Dog("rex").bark(), new Dog("rex").bark() + 1, half(new Dog("rex").bark())]);
attempt("a class: a method that is not there", () => new Dog("rex").wag());
attempt("a class: extended", () => {
  class Puppy extends Dog {
    small = true;
    bark(): number {
      return super.bark() + 1;
    }
  }
  const p = new Puppy("pup");
  return [p.bark(), p.legs, Object.keys(p)];
});
attempt("parameters in another order", () => takes(1, "s"));
attempt("an enum", () => [Color.Red, Color.Green, Color.Red === 0, Color.Green + 1, typeof Color.Red, Color[0]]);
attempt("an enum: switch", () => {
  const name = (c: Color): string => {
    switch (c) {
      case Color.Red:
        return "red";
      case Color.Green:
        return "green";
    }
  };
  return [name(Color.Red), name(Color.Green), name(0), name(1)];
});
attempt("a const enum", () => [Level.Low, Level.High, Level.Low + 1]);
attempt("the module calls back", () => callBack(half));
attempt("the module calls back a closure", () => callBack(n => n + 1));
attempt("the default export", () => [main(), main() + 1, typeof main()]);
attempt("honest again", () => [half(4), plusOne(1), size("ab"), total([1, 2]), sum({ x: 1, y: 2 })]);

// FILE: library.d.ts
export declare function count(): number;
export declare function label(): string;
export declare function list(): number[];
export declare function point(): { x: number; y: number };
export declare function step(): (n: number) => number;
export declare function maybe(): number;
export declare const limit: number;
export declare const version: 3;
export declare const names: readonly string[];
export declare let mutable: number;
export declare function spoil(): void;
export declare class Dog {
  legs: number;
  name: string;
  static kinds: number;
  constructor(name: string);
  bark(): number;
  wag(): number;
}
export declare function takes(n: number, s: string): string;
export declare enum Color {
  Red = 0,
  Green = 1,
}
export declare const enum Level {
  Low = 1,
  High = 2,
}
export declare function callBack(f: (n: number) => number): number[];
export default function main(): number;

// FILE: library.js
export function count() {
  return "7";
}

export function label() {
  return 42;
}

export function list() {
  return { length: 2, 0: 1, 1: "2" };
}

export function point() {
  return { y: "2", get x() { return 1; } };
}

export function step() {
  return n => String(n) + "!";
}

export function maybe() {}

export const limit = "10";
export const version = 4;
export const names = new Set(["a", "b"]);
export let mutable = 1;

export function spoil() {
  mutable = "spoiled";
}

export class Dog {
  constructor(name) {
    this.title = name;
  }
  bark() {
    return "woof";
  }
}

export function takes(s, n) {
  return typeof s + ":" + typeof n;
}

export const Color = { Red: "red", Green: 5 };
export const Level = { Low: 10, High: 20 };

export function callBack(f) {
  return [f("8"), f(null), f()];
}

export default function main() {
  return null;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: half total Holder take Puppy bark
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Less v8, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Convert v12 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v14 = ElemGet v0, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_9]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v16 = Add v5, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v13
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Jump -> next b2(v17, v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Convert v5 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_11]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=env [[L_12]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_12]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="count"
// CHECK-NEXT: v5 = Call v4 calleeName="count"
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_15]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: PutEnvironmentField v0, v6 layout=[[L_12]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Puppy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_16]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_16]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_17]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=function flags=[IsFromCompiler]}] thisType={type=[[L_16]] site=[[w_18]]} results=[{type=number site=[[w_19]]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: function, v1: [[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v0 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v1 key="bark"
// CHECK-NEXT: v4 = Call v3, v1 calleeName="super.bark"
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_21]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_19]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
