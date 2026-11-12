// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="valueOf"

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
