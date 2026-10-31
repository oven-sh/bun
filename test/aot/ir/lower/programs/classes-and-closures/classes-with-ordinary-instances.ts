// RUN: lower
// OPTIONS: builtin-modules
// CWD: parallel/classes-and-closures/classes-with-ordinary-instances
// STATISTIC: SourceFilesChecked = 3

// FILE: parallel/classes-and-closures/classes-with-ordinary-instances/main.ts
// Classes whose instances stay ordinary JavaScript objects: they extend built-in classes, are evaluated more than once, or are used as values.
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

// FILE: parallel/classes-and-closures/classes-with-ordinary-instances/program.ts
class AppError extends Error {
  code: number
  constructor(message: string, code = 1) { super(message); this.name = "AppError"; this.code = code }
  describe(): string { return this.name + "(" + this.code + "): " + this.message }
  get isFatal(): boolean { return this.code > 9 }
}
class NotFound extends AppError {
  constructor(public what: string) { super(what + " not found", 44) ; this.name = "NotFound" }
  describe(): string { return "[" + super.describe() + "]" }
}
const e1 = new AppError("boom")
const e2 = new NotFound("file")
console.log(e1.describe(), e2.describe(), e1 instanceof Error, e2 instanceof AppError, e1 instanceof NotFound, e2.isFatal, e2.what, String(e2), Object.keys(e2).join())
try { throw new NotFound("key") } catch (e) { console.log(e instanceof NotFound && e.what, typeof (e as Error).stack) }

function make(tag: string) { return class { tag = tag; static made = tag + "!"; who(): string { return this.tag } } }
const A = make("a"), B = make("b")
console.log(new A().who(), new B().who(), A.made, B.made, new A() instanceof A, new A() instanceof B, A === B, typeof A, A.name)

const key = "dynamic", staticKey = key + "Static", fieldKey = "field" + 1
class Computed { [key]() { return 1 } static [staticKey] = 2; [fieldKey] = 3; get [key + "Get"]() { return 4 } }
const c: any = new Computed()
console.log(c.dynamic(), (Computed as any).dynamicStatic, c.field1, c.dynamicGet, Object.getOwnPropertyNames(Computed.prototype).join())

class Counter { static n = 0; static start = Counter.n + 100; static next() { return ++this.n } static create() { return new this() } id = Counter.next() }
console.log(Counter.create().id, Counter.create().id, Counter.n, Counter.start)
const classes: Ctor[] = [Counter, AppError]
console.log(classes.map(k => k.name).join(), new classes[0]!().constructor === Counter, Object.getPrototypeOf(NotFound) === AppError)

class Vault { #secret = 7; #twice() { return this.#secret * 2 } static has(o: object) { return #secret in o } open() { return this.#twice() + this.#secret++ } }
const vault: any = new Vault()
console.log(vault.open(), vault.open(), Vault.has(vault), Vault.has({}), Object.keys(vault).length, JSON.stringify(vault))

function Old(this: any, v: number) { this.v = v }
Old.prototype.get = function () { return this.v }
const old = new (Old as any)(5)
console.log(old.get(), old instanceof (Old as any), old.constructor === Old)
class Target { kind: string; constructor() { this.kind = new.target.name } }
class SubTarget extends Target {}
console.log(new Target().kind, new SubTarget().kind)
type Ctor<T = {}> = new (...args: any[]) => T
function Tagged<T extends Ctor>(Base: T) { return class extends Base { tagged = true } }
class Plain { plain = 1 }
const Mixed = Tagged(Plain)
const mixed = new Mixed()
console.log(mixed.tagged, mixed.plain, mixed instanceof Plain)
try { (AppError as any)("x") } catch (e) { console.log((e as Error).constructor.name) }

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
