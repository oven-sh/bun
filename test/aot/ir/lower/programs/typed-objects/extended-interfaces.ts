// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/typed-objects/extended-interfaces
// STATISTIC: SourceFilesChecked = 3

// FILE: parallel/typed-objects/extended-interfaces/main.ts
// Objects created as one interface are read and written through the interfaces it extends, several levels up, at one site.
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

// FILE: parallel/typed-objects/extended-interfaces/program.ts
interface Named { label: string }
interface Sized extends Named { size: number }
interface Priced extends Sized { price: number; currency?: string }
interface Tagged extends Named { tags: string[] }
interface Full extends Priced, Tagged { active: boolean }
interface Merged { a: number }
interface Merged { b: string; c?: boolean }
interface Greeter extends Named { greet(punctuation: string): string }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function labelOf(n: Named): string { return n.label }
function twice(s: Sized): number { return s.size * 2 }
function cost(p: Priced): string { return p.price + (p.currency ?? "?") }
function rename(n: Named, to: string): void { n.label = to }
function grow(s: Sized, by: number): number { s.size += by; return s.size }
const named: Named = { label: "n" }
const sized: Sized = { label: "s", size: 1 }
const swapped: Sized = { size: 2, label: "w" }
const priced: Priced = { price: 9.5, label: "p", size: 3 }
const pricedFull: Priced = { currency: "EUR", label: "q", size: 4, price: -0 }
const tagged: Tagged = { tags: ["x", "y"], label: "t" }
const full: Full = { active: true, tags: [], price: 1e21, size: 5, label: "f" }
const everyone: Named[] = [named, sized, swapped, priced, pricedFull, tagged, full]
const sizeds: Sized[] = [sized, swapped, priced, pricedFull, full]
const priceds: Priced[] = [priced, pricedFull, full]
console.log(everyone.map(labelOf).join(), sizeds.map(twice).join(), priceds.map(cost).join())
console.log(everyone.map(show).join(" ; "))
for (const n of everyone) rename(n, n.label + "!")
console.log(full.label, priced.label, swapped.label, tagged.label, named.label, sizeds.map(s => grow(s, 0.5)).join())
console.log(sized.size, swapped.size, priced.size, pricedFull.size, full.size, Object.is(pricedFull.price, -0))

// An optional field of a base interface, stored late through the base.
const asPriced: Priced = full
asPriced.currency = "USD"
console.log(full.currency, show(full), "currency" in priced, priced.currency, Object.hasOwn(priced, "currency"), cost(full))

function describe(n: Named): string {
  let out = n.label
  if ("size" in n) out += " size " + (n as Sized).size
  if ("price" in n) out += " price " + (n as Priced).price
  if ("tags" in n) out += " tags " + (n as Tagged).tags.length
  if ("active" in n) out += " active " + (n as Full).active
  return out
}
console.log(everyone.map(describe).join(" ; "))

// Two declarations of one interface are one type.
const merged: Merged = { b: "b", a: 1 }
const half: { a: number } = merged
half.a = 7
merged.c = false
console.log(show(merged), merged.a, half.a, half === merged)

const greeter: Greeter = { label: "g", greet(punctuation) { return "hi " + this.label + punctuation } }
const alsoNamed: Named = greeter
rename(alsoNamed, "G")
console.log(greeter.greet("!"), labelOf(greeter), Object.keys(greeter).join(), typeof (alsoNamed as Greeter).greet)

function pick(i: number): Named { return i === 0 ? { label: "fresh" } : i === 1 ? sized : full }
console.log(pick(0).label, pick(1).label, pick(2).label, pick(1) === sized, show(pick(0)), describe(pick(2)))

let total = 0
for (let i = 0; i < 3000; i++) total += twice(sizeds[i % sizeds.length]) + labelOf(everyone[i % everyone.length]).length
console.log(total)

// A tower of interfaces, each adding one field: the lowest object is read at every level.
interface L0 { f0: number }
interface L1 extends L0 { f1: string }
interface L2 extends L1 { f2: boolean }
interface L3 extends L2 { f3: number | null }
interface L4 extends L3 { f4: L0 }
const bottom: L4 = { f4: { f0: -1 }, f3: null, f2: true, f1: "one", f0: 0.25 }
const levels: [L0, L1, L2, L3, L4] = [bottom, bottom, bottom, bottom, bottom]
levels[0].f0 *= 2; levels[1].f1 += "!"; levels[2].f2 = !levels[2].f2; levels[3].f3 = 3; levels[4].f4 = levels[0]
console.log(bottom.f0, bottom.f1, bottom.f2, bottom.f3, bottom.f4 === bottom, Object.keys(bottom).join(), levels[4].f4.f0)

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
