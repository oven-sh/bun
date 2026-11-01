// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Typescript believes the false tags of an unchecked js module.
import { callBack, count, Dog, fail, flag, isNumber, label, Level, limit, list, mutable, nothing, point, spoil, step, takes, version, wrap } from "./library.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

function total(numbers: number[]): number {
  let result = 0;
  for (let i = 0; i < numbers.length; i++) result += numbers[i];
  return result;
}

class Holder {
  n = count();
  s = label();
  p = point();
  next(): number {
    return this.n + 1;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + sum({ x: i, y: 1 }) + total([i]);
console.log("2000 honest rounds: " + warm);

attempt("a number", () => [count(), typeof count(), count() + 1, count() * 2, plusOne(count()), [0, 1, 2, 3, 4, 5, 6, 7][count()]]);
attempt("a number in a local, a list and a map", () => {
  const n: number = count();
  const numbers: number[] = [1, count()];
  const map = new Map<string, number>([["k", count()]]);
  return [n + 1, total(numbers), (map.get("k") ?? 0) + 1];
});
attempt("a text", () => [label(), typeof label(), label() + "!", label() + 1]);
attempt("the size of a text", () => size(label()));
attempt("a point", () => [point().x, point().x + point().y, sum(point()), Object.keys(point()).join(), JSON.stringify(point())]);
attempt("a list", () => [total(list()), list().map(plusOne), list().length]);
attempt("a function", () => [step()(1), step()(1) + 1, [1, 2].map(step())]);
attempt("a truth", () => [flag() === false, flag() === true, flag() ? "truthy" : "falsy", typeof flag()]);
attempt("nothing", () => [nothing(), nothing() + 1, plusOne(nothing())]);
attempt("constants", () => [limit, limit + 1, plusOne(limit), version, version === 3, version + 1]);
attempt("a variable", () => {
  const before = mutable + 1;
  spoil();
  return [before, mutable, mutable + 1, plusOne(mutable)];
});
attempt("fields of a holder", () => {
  const holder = new Holder();
  return [holder.next(), holder.s + "!", sum(holder.p), JSON.stringify(holder)];
});
attempt("a class", () => {
  const dog = new Dog("rex");
  return [dog.name, dog.name + "!", dog.legs, dog.legs + 1, dog.bark(), dog.bark() + 1, Dog.kinds + 1, JSON.stringify(dog)];
});
attempt("the size of a field", () => size(new Dog("rex").name));
attempt("a subclass", () => {
  class Puppy extends Dog {
    small = true;
    legsPlusOne(): number {
      return this.legs + 1;
    }
  }
  const puppy = new Puppy("p");
  return [puppy.legsPlusOne(), puppy.small, Object.keys(puppy).join()];
});
attempt("operands", () => [takes(1, "s"), takes(1.5, "")]);
attempt("a callback", () => [callBack(plusOne), callBack(n => n * 2), callBack(Math.abs)]);
attempt("a template", () => [wrap(5), typeof wrap(5), wrap("ab").length]);
attempt("a template, a method of lists", () => wrap(5).map(plusOne));
attempt("a guard", () => {
  const values: unknown[] = [1, "1", null, [1]];
  return values.map(v => (isNumber(v) ? v + 1 : "no number"));
});
attempt("never", () => {
  fail();
  return "the statement after the call ran";
});
attempt("never narrows", () => {
  const n: number | undefined = [1][1];
  if (n === undefined) fail();
  return n + 1;
});
attempt("an enum", () => [Level.Low, Level.Low + "!", plusOne(Level.High)]);

// FILE: library.js
/** @returns {number} */
export function count() {
  return "7";
}

/** @returns {string} */
export function label() {
  return 42;
}

/** @returns {{ x: number, y: number }} */
export function point() {
  return { y: "2", x: "1", z: 3 };
}

/** @returns {number[]} */
export function list() {
  return ["1", 2, null];
}

/** @returns {(n: number) => number} */
export function step() {
  return n => n + "!";
}

/** @returns {boolean} */
export function flag() {
  return 0;
}

/** @returns {number} */
export function nothing() {}

/** @type {number} */
export const limit = "10";

/** @type {3} */
export const version = 4;

/** @type {number} */
export let mutable = 1;

export function spoil() {
  mutable = "spoiled";
}

export class Dog {
  /** @param {string} name */
  constructor(name) {
    /** @type {string} */
    this.name = name.length;
    /** @type {number} */
    this.legs = "four";
  }

  /** @returns {number} */
  bark() {
    return "woof";
  }

  /** @type {number} */
  static kinds = "many";
}

/**
 * @param {number} n
 * @param {string} s
 * @returns {string}
 */
export function takes(n, s) {
  return typeof n + " " + typeof s + " " + (n + s);
}

/**
 * @param {(n: number) => number} f
 * @returns {number[]}
 */
export function callBack(f) {
  return [f("1"), f(null), f()];
}

/**
 * @template T
 * @param {T} value
 * @returns {T[]}
 */
export function wrap(value) {
  return value;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export function isNumber(v) {
  return true;
}

/** @returns {never} */
export function fail() {
  return "came back";
}

/** @enum {number} */
export const Level = { Low: "low", High: 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: size total Holder next Puppy
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
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
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_12]]} results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="n"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Puppy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_16]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
