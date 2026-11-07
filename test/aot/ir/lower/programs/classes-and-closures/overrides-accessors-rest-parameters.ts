// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/classes-and-closures/overrides-accessors-rest-parameters
// STATISTIC: SourceFilesChecked = 3

// FILE: parallel/classes-and-closures/overrides-accessors-rest-parameters/main.ts
// Overridden methods, accessors, and rest parameters of methods and function values.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";

// FILE: fixtures/jsc-shell-functions.ts
// Some of these programs were written for the `jsc` shell. This module defines the shell's global functions that they use, both
// under plain Bun and in a compiled executable. A program that needs them imports this module first.
import { drainMicrotasks, edenGC, fullGC, heapStats, jscDescribe } from "bun:jsc";
import { runInNewContext } from "node:vm";

// heapStats() also answers with the statistics of the allocator and with the kinds of the protected cells: some 170 objects that the
// shell's function does not make. A program that counts cells collects first, and a collection keeps what a word left on the stack
// still names: a cell or two. For one of these objects to be no more than that, none of them refers to another once this has run.
function separate(whole: any, listed?: unknown[]): void {
  if (Array.isArray(whole)) {
    listed?.push(...whole);
    for (let index = 0; index < whole.length; index++) cut(whole, index, listed);
  } else for (const key in whole) cut(whole, key, listed);
}
function cut(whole: any, key: string | number, listed?: unknown[]): void {
  const part = whole[key];
  if (typeof part !== "object" || part === null) return;
  whole[key] = undefined;
  separate(part, listed);
}
function statisticsAsTheShellGivesThem(listed?: unknown[]): any {
  const statistics: any = heapStats();
  const { objectTypeCounts } = statistics;
  statistics.objectTypeCounts = undefined;
  separate(statistics, listed);
  statistics.objectTypeCounts = objectTypeCounts;
  return statistics;
}
// An object also keeps its Structure, and that one the Structures it came from. Most of these objects stand in lists, many of one form.
// Those of one answer stay for good, so that the Structures of these forms are there whether or not a word names such an object.
let listedInOneAnswer: unknown[] | undefined;

Object.assign(globalThis, {
  // These only influence the JIT, never what a function does.
  noInline: () => {},
  neverInlineFunction: () => {},
  noDFG: () => {},
  noFTL: () => {},
  noOSRExitFuzzing: () => {},
  fullGC,
  edenGC,
  drainMicrotasks,
  gc: () => Bun.gc(true),
  describe: jscDescribe,
  generateHeapSnapshot: () => Bun.generateHeapSnapshot(),
  memoryUsageStatistics: () => {
    if (!listedInOneAnswer) statisticsAsTheShellGivesThem((listedInOneAnswer = []));
    return statisticsAsTheShellGivesThem();
  },
  jscOptions: () => ({}),
  createGlobalObject: () => runInNewContext("globalThis"),
  preciseTime: () => performance.now() / 1000,
  sleepSeconds: (seconds: number) => Bun.sleepSync(seconds * 1000),
});

// FILE: parallel/classes-and-closures/overrides-accessors-rest-parameters/program.ts
abstract class Shape {
  constructor(public name: string) {}
  abstract area(): number
  describe(): string { return this.name + ":" + this.area().toFixed(2) }
  get label(): string { return "<" + this.name + ">" }
}
class Circle extends Shape { constructor(public r: number) { super("circle") } area(): number { return Math.PI * this.r * this.r } }
class Square extends Shape { constructor(public s: number) { super("square") } area(): number { return this.s * this.s } get label(): string { return "[" + this.name + "]" } }
class Cube extends Square { area(): number { return 6 * this.s * this.s } describe(): string { return "cube!" + this.area() } }
const shapes: Shape[] = [new Circle(1), new Square(2), new Cube(3), new Circle(0.5)]
let total = 0
for (const shape of shapes) total += shape.area()
console.log(total.toFixed(3), shapes.map(s => s.describe()).join(" "), shapes.map(s => s.label).join(""))

class Temperature {
  private kelvin = 0
  get celsius(): number { return this.kelvin - 273.15 }
  set celsius(v: number) { this.kelvin = v + 273.15 }
}
class Clamped extends Temperature { set celsius(v: number) { super.celsius = Math.max(v, -273.15) } get celsius(): number { return super.celsius } }
const t = new Temperature()
t.celsius = 26.85
t.celsius += 1
console.log(t.celsius.toFixed(2))

class Logger {
  lines: string[] = []
  log(level: string, ...parts: (string | number)[]): number { this.lines.push(level + ":" + parts.join("|")); return parts.length }
}
class Loud extends Logger { log(level: string, ...parts: (string | number)[]): number { return super.log(level.toUpperCase(), ...parts, "!") } }
const plain = new Logger()
console.log(plain.log("a"), plain.log("b", 1), plain.log("c", 1, "two", 3), plain.lines.join(" "))
const collect = (first: number, ...rest: number[]) => first * 100 + rest.length * 10 + (rest[1] ?? 0)
const pick = [collect, (a: number, ...r: number[]) => a + r.length]
console.log(collect(1), collect(1, 2), collect(1, 2, 3, 4), pick[0]!(1, 2, 3), pick[1]!(1, 2, 3), pick.map(f => f(5, 6)).join())
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 }
const indirect: any = many
console.log(many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), indirect(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))

// FILE: fixtures/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// FILE: parallel/tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
