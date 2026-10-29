// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 14
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Where `require()` of an ES module differs from an import: the module is evaluated at the call, once; a destructured name is a copy; the variable that holds the module has a dead zone of its own; the object is the one that `import *` yields and says `__esModule` from the first `require` on.
import { log, attempt } from "./log";
import * as marked from "./marked";
import * as markedLate from "./marked-late";
import * as marksItself from "./marks-itself";
import "./typed";
type Required = [typeof import("./effects"), typeof import("./effects-late"), typeof import("./marked-before-it-is-made"), typeof import("./whole-export"), typeof import("./throws"), typeof import("./types-alone")];

log("1 order");
log("before");
const first = require("./effects").value;
log("between", first);
const { value: again } = require("./effects");
log("after", again);
function lazily() {
  log("in the function");
  return require("./effects-late").value;
}
log(lazily(), lazily());

log("2 copies and live bindings");
const live = require("./counter") as typeof import("./counter");
const { count: copied, read, replaced: copyOfReplaced } = require("./counter") as typeof import("./counter");
live.increment();
live.replace();
log(copied, live.count, require("./counter").count, read(), copyOfReplaced(), live.replaced(), require("./counter").replaced());

log("3 dead zones of the variables");
function readsEarly() {
  return early.count;
}
function readsCopyEarly() {
  return earlyCopy;
}
function typeofEarly() {
  return typeof early;
}
log(attempt(readsEarly), attempt(readsCopyEarly), attempt(typeofEarly));
const early = require("./counter") as typeof import("./counter");
const { count: earlyCopy } = require("./counter") as typeof import("./counter");
log(attempt(readsEarly), attempt(readsCopyEarly), attempt(typeofEarly));

log("4 the mark");
const seen = (ns: object) => String((ns as any).__esModule) + ":" + Object.keys(ns).join();
log(seen(marked), seen(markedLate), Object.keys(marksItself).join());
log(require("./marked").a, seen(marked), require("./marked").__esModule);
const { a: ofLate } = require("./marked-late");
log(ofLate, seen(markedLate));
log(require("./marks-itself").a, Object.keys(marksItself).join(), require("./marks-itself").__esModule, require("./marks-itself") === marksItself);
require("./marked-before-it-is-made");
log(seen(await import("./marked-before-it-is-made")));
log(seen(await import("./never-required")));

log("5 as a value");
const whole = require("./marked") as typeof import("./marked");
const key = "a";
log(whole === marked, typeof whole, Object.keys(whole).join(), (whole as any)[key], JSON.stringify(whole), JSON.stringify({ ...whole }), String(Object.prototype.toString.call(whole)));
log([whole].includes(marked), ((given: unknown) => given === marked)(whole), (() => whole)() === marked);
for (const name in whole) log(name);
log(attempt(() => ((whole as any).a = 5)), attempt(() => delete (whole as any).a), attempt(() => ((require("./marked") as any).a = 6)), whole.a);
log((whole as any).absent, (require("./marked") as any).absent, (whole as any).toString, (whole as any)["absent"]);
const { absent = "by default", a: present = "unused" } = require("./marked") as any;
log(absent, present);
const { a: one, ...others } = require("./marked") as any;
log(one, JSON.stringify(others));

log("6 this");
log(whole.self() === marked, require("./marked").self() === marked, whole.strict(), (0, whole.self)() === undefined);

log("7 another require");
function shadowed(require: (name: string) => unknown) {
  return require("./marked");
}
log(shadowed(name => "mine: " + name));
{
  const require = (name: string) => ({ a: "inner " + name });
  log(require("./marked").a);
}

log("8 module.exports");
log(JSON.stringify(require("./whole-export")), require("./whole-export").a, typeof require("./whole-export"));

log("9 a module that throws");
log(attempt(() => require("./throws").a), attempt(() => require("./throws").a), attempt(() => { const { a } = require("./throws"); return a; }));

log("10 types alone");
log((require("./types-alone") as any).OnlyAType, Object.keys(require("./types-alone")).join());

log("11 closures");
function makes() {
  const inner = require("./counter") as typeof import("./counter");
  return () => inner.count + (inner === live ? 1000 : 0);
}
log(makes()());

log("12 this, for a function that is not known");
{
  const hooks = require("./hooks") as typeof import("./hooks");
  log(hooks.ofAnObject(), hooks.called(), hooks.changing(), hooks.made(), (require("./hooks") as typeof import("./hooks")).ofAnObject());
  hooks.swap();
  log(hooks.changing(), hooks.arrow(), hooks.looksAtNothing());
}

log("13 looked at as any, or as another type");
{
  const { twice, describe, kept } = require("./typed");
  const typed = require("./typed");
  type Other = { twice(n: unknown): unknown; kept(): unknown; describe(root: unknown): string };
  const other = require("./typed") as Other;
  log(require("./typed").twice(2), twice(3), typed.twice(4), other.twice(5), (require("./typed") as Other).twice(6));
  log(describe(kept()), typed.describe(typed.kept()), other.describe(other.kept()), typed === other, Object.keys(typed).join());
}

// FILE: counter.js
export let count = 0;
export function increment() {
  count++;
}
export function read() {
  return count;
}
export function replaced() {
  return "original";
}
export function replace() {
  replaced = () => "replacement";
}

// FILE: effects-late.ts
console.log("effects-late is evaluated");
export const value = 2;

// FILE: effects.ts
console.log("effects is evaluated");
export const value = 1;

// FILE: hooks.ts
let count = 0;
export function called(): number { return count; }
export function note(): void { count++; }
const holder = { method(this: any): string { this.note(); return typeof this.called; } };
export const ofAnObject: (this: any) => string = holder.method;
export let changing: (this: any) => string = function (this: any) { return "first " + Object.keys(this).length; };
export function swap(): void { changing = function (this: any) { return "second " + typeof this.swap; }; }
export const made = ((): ((this: any) => string) => function (this: any) { return "made " + typeof this.made; })();
export const arrow = (): string => "arrow";
export function looksAtNothing(): string { return "nothing"; }

// FILE: log.ts
export function log(...values: unknown[]) {
  console.log(...values.map(value => (typeof value === "function" ? "function " + value.name : value)));
}
export function attempt(run: () => unknown) {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

// FILE: marked-before-it-is-made.ts
export const a = 1;

// FILE: marked-late.ts
export const a = 1;

// FILE: marked.ts
export const a = 1;
export function self(this: unknown) {
  return this;
}
export function strict(this: unknown) {
  return typeof this;
}

// FILE: marks-itself.ts
export const a = 1;
export const __esModule = "its own";

// FILE: never-required.ts
export const a = 1;

// FILE: throws.ts
console.log("throws is evaluated");
export const a = 1;
throw new RangeError("from the module");

// FILE: typed.ts
export class Owner { uses = 0; use(): number { return ++this.uses; } }
export interface Root { readonly owner: Owner; readonly id: string }
let held: Root = { owner: new Owner(), id: "first" };
export function kept(): Root { return held; }
export function keep(root: Root): void { held = root; }
export function describe(root: Root): string { return root.id + ":" + root.owner.uses; }
export function twice(n: number): number { return n * 2; }

// FILE: types-alone.ts
export type OnlyAType = number;
export interface AlsoAType {}
export const value = 1;

// FILE: whole-export.ts
const whole = { a: "of the object" };
export { whole as "module.exports" };
export const a = "of the module";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: lazily readsEarly typeofEarly shadowed makes seen require
// CHECK-LABEL: function {{*}}name="lazily"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = String string="in the function"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="log"
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="value"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readsEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_4]]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="early"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="count"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="typeofEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="early"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="./marked"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="require"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="makes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_15]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_15]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_15]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleNamespace module=[[m_15]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure v4 function=[[f_16]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_20]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="__esModule"
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="String"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_26]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="inner "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_24]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_24]] site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
