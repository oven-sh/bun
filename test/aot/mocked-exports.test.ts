import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

type When = "top" | "late" | "spied" | "preload" | "ahead";

type Kind = {
  when: When[];
  module?: string;
  mock: string;
  imports?: string;
  helpers?: string;
  uses: string[];
  own?: string[];
  ownHelpers?: string;
  extension?: string;
  target?: string;
  files?: Record<string, string>;
};

const kinds: Record<string, Kind> = {
  "function-more": {
    when: ["top", "late", "spied"],
    module: `export function V(n: number): number { return n + 1; }`,
    mock: `{ V: (n: number) => n + 100 }`,
    helpers: [
      `const one: [number] = [1];`,
      `function later(): (n: number) => number { return V; }`,
      `class Keeper { f = V; static g = V; }`,
      `function byDefault(f = V): number { return f(1); }`,
      `function viaConditional(c: boolean): number { return (c ? V : Math.abs)(1); }`,
      `function viaOr(n: number): number { return (V || Math.abs)(n); }`,
      `const viaObject = { f: V };`,
      `let held = V;`,
      `function viaLet(n: number): number { return held(n); }`,
      `const first = V; const second = first;`,
      `function chain(n: number): number { return second(n); }`,
    ].join("\n"),
    uses: [
      `V(...[1])`,
      `V(...one)`,
      `V?.(1)`,
      `Reflect.apply(V, null, [1])`,
      `({ V }).V(1)`,
      `[V][0](1)`,
      `(V as (n: number) => number)(1)`,
      `V!(1)`,
      `V.name.length > 0`,
      `V instanceof Function`,
      `later()(1)`,
      `new Keeper().f(1)`,
      `Keeper.g(1)`,
      `byDefault()`,
      `viaConditional(true)`,
      `viaOr(1)`,
      `Promise.resolve(1).then(V)`,
      `viaObject.f(1)`,
      `viaLet(1)`,
      `chain(1)`,
    ],
    own: [`V(1)`, `V(...[1])`, `[1].map(V).join()`, `ownKept(1)`, `(() => V)()(1)`],
    ownHelpers: `const ownKept = V;`,
  },
  "function-with-rest": {
    when: ["top", "late", "spied"],
    module: `export function V(first: number, ...rest: number[]): number { return first + rest.length; }`,
    mock: `{ V: (first: number, ...rest: number[]) => first + rest.length + 100 }`,
    imports: [`import { V } from "./a";`, `import * as ns from "./a";`].join("\n"),
    helpers: `const list: [number, number] = [1, 2];`,
    uses: [`V(1)`, `V(1, 2, 3)`, `V(1, ...[2, 3])`, `V(...list)`, `ns.V(1, ...[2, 3])`, `ns.V(...list)`],
    own: [`V(1, ...[2, 3])`],
  },
  "function-whose-result-is-dropped": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [`export function V(n: number): void {}`, `export function pure(n: number): number { return n; }`].join(
      "\n",
    ),
    mock: `{ V: mock((n: number) => {}), pure: mock((n: number) => n) }`,
    imports: `import { V, pure } from "./a";`,
    helpers: `function dropped(): void { pure(1); V(2); }`,
    uses: [
      `(V(1), (V as any).mock?.calls.length)`,
      `(pure(1), (pure as any).mock?.calls.length)`,
      `(dropped(), (pure as any).mock?.calls.length)`,
    ],
  },
  "function-that-returns-a-constant": {
    when: ["top", "late", "spied"],
    module: [
      `export function V(): number { return 5; }`,
      `export function flag(): boolean { return true; }`,
      `export const arrow = (): string => "real";`,
    ].join("\n"),
    mock: `{ V: () => 6, flag: () => false, arrow: () => "mocked" }`,
    imports: `import { V, flag, arrow } from "./a";`,
    helpers: `function branch(): string { if (flag()) return "taken"; return "not taken"; }`,
    uses: [
      `V()`,
      `V() === 5 ? "five" : "other"`,
      `flag() ? "yes" : "no"`,
      `arrow()`,
      `arrow() === "real"`,
      `\`\${V()}\``,
      `V() + 1`,
      `branch()`,
    ],
    own: [`V() === 5 ? "five" : "other"`, `flag() ? "yes" : "no"`],
  },
  "function-that-hands-back-its-argument": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export function V<T>(value: T): T { return value; }`,
    mock: `{ V: <T,>(value: T): T => structuredClone(value) }`,
    helpers: `const box = { a: 1 };`,
    uses: [`V({ a: 1 })`, `V({ a: 1 }).a`, `V(box) === box`, `V(1)`],
  },
  "function-overloaded": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export function V(n: number): number;`,
      `export function V(n: string): string;`,
      `export function V(n: number | string): number | string { return typeof n === "number" ? n + 1 : n + "!"; }`,
    ].join("\n"),
    mock: `{ V: (n: number | string) => typeof n === "number" ? n + 100 : n + "?" }`,
    uses: [`V(1)`, `V("a")`],
  },
  "function-with-properties": {
    when: ["top", "late", "spied"],
    module: [`export function V(n: number): number { return n + 1; }`, `V.extra = "real extra";`].join("\n"),
    mock: `{ V: Object.assign((n: number) => n + 100, { extra: "mocked extra" }) }`,
    uses: [`V(1)`, `V.extra`],
    own: [`V.extra`],
  },
  "function-generic-callback": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export function V(f: (n: number) => number): number { return f(1); }`,
    mock: `{ V: (f: (n: number) => number) => f(100) }`,
    helpers: `function double(n: number): number { return n * 2; }`,
    uses: [`V(n => n + 1)`, `V(double)`],
  },
  "function-returning-a-record": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export interface P { x: number; y: string }`,
      `export function V(): P { return { x: 1, y: "real" }; }`,
    ].join("\n"),
    mock: `{ V: () => ({ y: "mocked", x: 2 }) }`,
    imports: [`import { V } from "./a";`, `import type { P } from "./a";`].join("\n"),
    helpers: `function takes(p: P): string { return p.y + p.x; }`,
    uses: [`V().x`, `V().y`, `JSON.stringify(V())`, `takes(V())`, `(({ x }) => x)(V())`],
  },
  "odd-function-returning-a-partial-record": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export interface P { x: number; y: string }`,
      `export function V(): P { return { x: 1, y: "real" }; }`,
    ].join("\n"),
    mock: `{ V: () => ({ x: 2 }) as any }`,
    uses: [`V().x`, `V().y`, `JSON.stringify(V())`],
  },
  "async-more": {
    when: ["top", "late", "spied"],
    module: `export async function V(n: number): Promise<number> { return n + 1; }`,
    mock: `{ V: mock(async (n: number) => n + 100) }`,
    helpers: `async function both(): Promise<number> { const [a, b] = await Promise.all([V(1), V(2)]); return a + b; }`,
    uses: [`await V(1)`, `await V(1).then(n => n + 1)`, `await both()`, `(V as any).mock?.calls.length`],
    own: [`await V(1)`],
  },
  "async-mocked-by-resolved-value": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export interface U { id: number; name: string }`,
      `export async function V(id: number): Promise<U> { return { id, name: "real" }; }`,
    ].join("\n"),
    mock: `{ V: mock().mockResolvedValue({ id: 9, name: "mocked" }) }`,
    uses: [`(await V(1)).name`, `(await V(1)).id`, `JSON.stringify(await V(1))`],
  },
  "async-generator": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export async function* V(n: number): AsyncGenerator<number> { yield n; }`,
    mock: `{ V: async function* (n: number) { yield n + 100; } }`,
    helpers: `async function collect(): Promise<string> { const got: number[] = []; for await (const n of V(1)) got.push(n); return got.join(); }`,
    uses: [`await collect()`],
  },
  "generator-delegated": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export function* V(n: number): Generator<number> { yield n; }`,
    mock: `{ V: function* (n: number) { yield n + 100; } }`,
    helpers: `function* outer(): Generator<number> { yield* V(1); }`,
    uses: [`[...outer()].join()`],
  },
  tag: {
    when: ["top", "late", "spied"],
    module: `export function V(strings: TemplateStringsArray, ...values: number[]): string { return "real " + strings.join("|") + values.join(); }`,
    mock: `{ V: (strings: TemplateStringsArray, ...values: number[]) => "mocked " + strings.join("|") + values.join() }`,
    uses: [`V\`a\${1}b\``],
    own: [`V\`a\${1}b\``],
  },
  "class-more": {
    when: ["top", "late", "spied"],
    module: `export class V { v: number = 1; constructor(public w: number = 2) {} m(): string { return "real m"; } get g(): string { return "real g"; } static s(): string { return "real s"; } static t: string = "real t"; static make(): V { return new V(); } static get sg(): string { return "real sg"; } }`,
    mock: `{ V: class V { v: number = 10; w: number; constructor(w: number = 20) { this.w = w; } m(): string { return "mocked m"; } get g(): string { return "mocked g"; } static s(): string { return "mocked s"; } static t: string = "mocked t"; static make(): any { return new this(); } static get sg(): string { return "mocked sg"; } } }`,
    helpers: [
      `class Sub extends V { own(): string { return "own " + this.m(); } }`,
      `class SubWithSuper extends V { constructor(w: number) { super(w + 1); } override m(): string { return "sub " + super.m(); } }`,
      `function lateSub(): typeof V { return class extends V {}; }`,
      `function isOne(x: unknown): boolean { return x instanceof V; }`,
      `class Holder { made = new V(); static kept = V; }`,
      `function staticsOf(C: { s(): string }): string { return C.s(); }`,
      `const keptClass = V;`,
    ].join("\n"),
    uses: [
      `V.s()`,
      `V.t`,
      `V.sg`,
      `V.make().m()`,
      `V["s"]()`,
      `V.s.call(V)`,
      `new V(...[3]).w`,
      `Reflect.construct(V, []).m()`,
      `new (V)().m()`,
      `new Sub().m()`,
      `new Sub().own()`,
      `Sub.s()`,
      `Sub.t`,
      `new Sub() instanceof V`,
      `new SubWithSuper(5).w`,
      `new SubWithSuper(5).m()`,
      `new (lateSub())().m()`,
      `Object.getPrototypeOf(Sub) === V`,
      `Object.getPrototypeOf(lateSub()) === V`,
      `V.prototype.m.call(null)`,
      `Object.getOwnPropertyNames(V.prototype).join()`,
      `isOne(new V())`,
      `isOne({})`,
      `new Holder().made.m()`,
      `Holder.kept === V`,
      `typeof V.s`,
      `"s" in V`,
      `staticsOf(V)`,
      `V.name`,
      `keptClass.make().m()`,
      `keptClass.make() instanceof keptClass`,
    ],
    own: [
      `V.s()`,
      `V.t`,
      `new V().m()`,
      `V.make().m()`,
      `new OwnSub().m()`,
      `new (ownLateSub())().m()`,
      `ownIsOne(new V())`,
      `ownKeptClass.make().m()`,
    ],
    ownHelpers: [
      `const ownKeptClass = V;`,
      `class OwnSub extends V {}`,
      `function ownLateSub(): typeof V { return class extends V {}; }`,
      `function ownIsOne(x: unknown): boolean { return x instanceof V; }`,
    ].join("\n"),
  },
  "class-mocked-by-a-function": {
    when: ["top", "late", "preload", "ahead"],
    module: `export class V { read(): string { return "a real read"; } static open(): V { return new V(); } }`,
    mock: `{ V: Object.assign(mock(function () { return { read: () => "a mocked read" }; }), { open: () => ({ read: () => "a mocked open" }) }) }`,
    uses: [`new V().read()`, `V.open().read()`, `(V as any).mock?.calls.length`],
  },
  "odd-class-mocked-in-part": {
    when: ["top", "late", "preload", "ahead"],
    module: `export class V { a(): string { return "real a"; } b(): string { return "real b"; } n: number = 1; }`,
    mock: `{ V: class { a(): string { return "mocked a"; } } }`,
    helpers: `function uses(v: V): string { return v.a(); }`,
    uses: [`new V().a()`, `typeof new V().b`, `new V().n`, `uses(new V())`],
  },
  "class-abstract": {
    when: ["top", "late", "preload", "ahead"],
    module: `export abstract class V { abstract m(): string; shared(): string { return "real shared " + this.m(); } }`,
    mock: `{ V: class { shared(): string { return "mocked shared " + (this as any).m(); } } }`,
    helpers: `class Impl extends V { m(): string { return "impl"; } }`,
    uses: [`new Impl().shared()`, `new Impl() instanceof V`],
  },
  "class-with-fields-extended": {
    when: ["top", "late", "preload", "ahead"],
    module: `export class V { a: number = 1; b: string = "real"; }`,
    mock: `{ V: class { a: number = 10; b: string = "mocked"; c: boolean = true; } }`,
    helpers: `class Sub extends V { d: number = 4; }`,
    uses: [`JSON.stringify(new Sub())`, `new Sub().a + new Sub().d`, `Object.keys(new Sub()).join()`],
  },
  "class-generic": {
    when: ["top", "late", "preload", "ahead"],
    module: `export class V<T> { constructor(public value: T) {} get(): T { return this.value; } tag(): string { return "real"; } }`,
    mock: `{ V: class<T> { value: T; constructor(value: T) { this.value = value; } get(): T { return this.value; } tag(): string { return "mocked"; } } }`,
    helpers: `class Sub extends V<number> {}`,
    uses: [`new V(1).get()`, `new V("a").value`, `new V(1).tag()`, `new Sub(1).get()`, `new Sub(1).tag()`],
  },
  "class-error": {
    when: ["top", "late", "spied"],
    module: `export class V extends Error { code = "REAL"; }`,
    mock: `{ V: class extends Error { code = "MOCKED"; } }`,
    helpers: `function caught(): string { try { throw new V("thrown"); } catch (e) { return e instanceof V ? "a V " + e.code : "another"; } }`,
    uses: [`new V("m").code`, `new V("m") instanceof Error`, `caught()`, `new V("m").message`],
    own: [`new V("m").code`],
  },
  "class-expression-in-a-constant": {
    when: ["top", "late"],
    module: `export const V = class { m(): string { return "real m"; } static s(): string { return "real s"; } };`,
    mock: `{ V: class { m(): string { return "mocked m"; } static s(): string { return "mocked s"; } } }`,
    helpers: `class Sub extends V {}`,
    uses: [`new V().m()`, `V.s()`, `new Sub().m()`],
    own: [`new V().m()`, `V.s()`],
  },
  "default-class": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export default class V { m(): string { return "real m"; } static s(): string { return "real s"; } }`,
    mock: `{ default: class { m(): string { return "mocked m"; } static s(): string { return "mocked s"; } } }`,
    imports: `import V from "./a";`,
    helpers: `class Sub extends V {}`,
    uses: [`new V().m()`, `V.s()`, `new Sub().m()`],
  },
  "instance-exported": {
    when: ["top", "late"],
    module: [`export class C { m(): string { return "real m"; } n = 1; }`, `export const V = new C();`].join("\n"),
    mock: `{ V: { m: () => "mocked m", n: 2 } }`,
    helpers: [
      `function uses(): string { return V.m() + V.n; }`,
      `const { n } = V;`,
      `function const_m(): number { return n; }`,
    ].join("\n"),
    uses: [`V.m()`, `V.n`, `uses()`, `const_m()`],
    own: [`V.m()`, `V.n`],
  },
  "enum-more": {
    when: ["top", "late"],
    module: [`export enum V { A = 1, B = 2, C = A | B }`, `export enum W { X = "x", Y = "y" }`].join("\n"),
    mock: `{ V: { A: 10, B: 20, C: 30, 10: "A", 20: "B", 30: "C" }, W: { X: "xx", Y: "yy" } }`,
    imports: [`import { V, W } from "./a";`, `import * as ns from "./a";`].join("\n"),
    helpers: [
      `function byDefault(v: V = V.B): V { return v; }`,
      `const table: Record<number, string> = { 1: "one", 10: "ten" };`,
      `function inSwitch(e: V): string { switch (e) { case V.A: return "case A"; case V.B: return "case B"; default: return "no case"; } }`,
      `class Holder { level = V.A; }`,
      `const kept = V.A;`,
      `function isA(v: V): boolean { return v === V.A; }`,
    ].join("\n"),
    uses: [
      `V.A`,
      `V.C`,
      `V["A"]`,
      `V[V.B]`,
      `V.A | V.B`,
      `V.A < V.B`,
      `\`\${V.A}\``,
      `W.X + W.Y`,
      `W.X === "x"`,
      `byDefault()`,
      `table[V.A]`,
      `inSwitch(1 as V)`,
      `inSwitch(10 as V)`,
      `Object.entries(W).join()`,
      `new Holder().level`,
      `kept`,
      `ns.V.A`,
      `typeof V`,
      `isA(V.A)`,
    ],
    own: [`V.A`, `V[V.B]`, `W.X`, `Object.keys(W).join()`, `ownSwitch(1 as V)`],
    ownHelpers: `function ownSwitch(e: V): string { switch (e) { case V.A: return "case A"; default: return "no case"; } }`,
  },
  "const-enum-more": {
    when: ["top", "late"],
    module: `export const enum V { A = 1, B = "b" }`,
    mock: `{ V: { A: 10, B: "bb" } }`,
    helpers: `const kept = V.B;`,
    uses: [`V.A`, `V.B`, `V.A === 1`, `kept`],
    own: [`V.A`, `V.B`],
  },
  "enum-reexported": {
    when: ["top", "late", "preload", "ahead"],
    module: `export enum V { A = 1 }`,
    mock: `{ V: { A: 10 } }`,
    imports: `import { V } from "./middle";`,
    uses: [`V.A`],
  },
  namespace: {
    when: ["top", "late"],
    module: `export namespace V { export const x: number = 1; export function f(): string { return "real f"; } export let y = "real y"; export namespace Inner { export const z = 3; } export enum E { A = 1 } export class C { m(): string { return "real m"; } } }`,
    mock: `{ V: { x: 10, f: () => "mocked f", y: "mocked y", Inner: { z: 30 }, E: { A: 10 }, C: class { m(): string { return "mocked m"; } } } }`,
    imports: [`import { V } from "./a";`, `import * as ns from "./a";`].join("\n"),
    helpers: [`const { f } = V;`, `function const_f(): string { return f(); }`].join("\n"),
    uses: [
      `V.x`,
      `V.f()`,
      `V.y`,
      `V.Inner.z`,
      `V.E.A`,
      `new V.C().m()`,
      `V.x === 1 ? "one" : "other"`,
      `Object.keys(V).join()`,
      `const_f()`,
      `ns.V.x`,
      `ns.V.f()`,
    ],
    own: [`V.x`, `V.f()`, `V.Inner.z`],
  },
  "namespace-merged-with-a-function": {
    when: ["top", "late"],
    module: [
      `export function V(): string { return "real call"; }`,
      `export namespace V { export const x: number = 1; }`,
    ].join("\n"),
    mock: `{ V: Object.assign(() => "mocked call", { x: 10 }) }`,
    uses: [`V()`, `V.x`],
    own: [`V()`, `V.x`],
  },
  "namespace-merged-with-a-class": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export class V { m(): string { return "real m"; } }`,
      `export namespace V { export const x: number = 1; }`,
    ].join("\n"),
    mock: `{ V: Object.assign(class { m(): string { return "mocked m"; } }, { x: 10 }) }`,
    uses: [`new V().m()`, `V.x`],
  },
  "import-equals": {
    when: ["top", "late", "preload", "ahead"],
    module: `export namespace N { export const x: number = 1; export function f(): string { return "real f"; } }`,
    mock: `{ N: { x: 10, f: () => "mocked f" } }`,
    imports: [`import { N } from "./a";`, `import x = N.x;`, `import f = N.f;`].join("\n"),
    uses: [`x`, `f()`, `N.x`],
  },
  "inferred-primitives": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const TIMEOUT = 5000;`,
      `export const VERBOSE = true;`,
      `export const NAME = "real";`,
      `export const BIG = 5n;`,
      `export const NEGATIVE = -1;`,
      `export const NOTHING = null;`,
      `export const TEMPLATE = \`a\${1}\`;`,
      `export const SUM = 1 + 2;`,
    ].join("\n"),
    mock: `{ TIMEOUT: 10, VERBOSE: false, NAME: "mocked", BIG: 6n, NEGATIVE: -2, NOTHING: null, TEMPLATE: "b", SUM: 4 }`,
    imports: `import { TIMEOUT, VERBOSE, NAME, BIG, NEGATIVE, NOTHING, TEMPLATE, SUM } from "./a";`,
    helpers: [
      `function takesNumber(n: number): number { return n * 2; }`,
      `function takesString(s: string): string { return s.toUpperCase(); }`,
      `function inSwitch(): string { switch (NAME as string) { case "real": return "the real case"; case "mocked": return "the mocked case"; default: return "neither"; } }`,
      `const kept = TIMEOUT;`,
      `const settings = { timeout: TIMEOUT, name: NAME };`,
    ].join("\n"),
    uses: [
      `TIMEOUT`,
      `TIMEOUT + 1`,
      `TIMEOUT === 5000`,
      `TIMEOUT > 100 ? "long" : "short"`,
      `VERBOSE`,
      `VERBOSE ? "loud" : "quiet"`,
      `!VERBOSE`,
      `NAME`,
      `NAME.length`,
      `NAME === "real"`,
      `NAME + "!"`,
      `\`\${NAME}\``,
      `BIG + 1n`,
      `NEGATIVE`,
      `Math.abs(NEGATIVE)`,
      `NOTHING`,
      `TEMPLATE`,
      `SUM`,
      `takesNumber(TIMEOUT)`,
      `takesString(NAME)`,
      `inSwitch()`,
      `({ real: 1, mocked: 2 } as Record<string, number>)[NAME]`,
      `new Array(SUM).length`,
      `kept`,
      `settings.timeout`,
      `[TIMEOUT, VERBOSE, NAME].join()`,
    ],
  },
  "inferred-primitives-behind-an-import": {
    when: ["top", "late"],
    module: [
      `import { nothing } from "./empty";`,
      `export const TIMEOUT = 5000;`,
      `export const VERBOSE = true;`,
      `export const NAME = "real";`,
      `export const seen = nothing;`,
    ].join("\n"),
    mock: `{ TIMEOUT: 10, VERBOSE: false, NAME: "mocked" }`,
    imports: `import { TIMEOUT, VERBOSE, NAME } from "./a";`,
    uses: [`TIMEOUT`, `VERBOSE ? "loud" : "quiet"`, `NAME`],
    own: [
      `TIMEOUT`,
      `TIMEOUT + 1`,
      `TIMEOUT === 5000`,
      `VERBOSE ? "loud" : "quiet"`,
      `NAME`,
      `NAME === "real"`,
      `\`\${NAME}\``,
      `ownBranch()`,
    ],
    ownHelpers: `function ownBranch(): string { if (VERBOSE) return "taken"; return "not taken"; }`,
  },
  "inferred-literal-passed-where-a-literal-is-asked": {
    when: ["top", "late", "preload", "ahead"],
    module: `export const MODE = "fast";`,
    mock: `{ MODE: "slow" }`,
    imports: `import { MODE } from "./a";`,
    helpers: `function run(mode: "fast" | "slow"): string { return mode === "fast" ? "quickly" : "slowly"; }`,
    uses: [`run(MODE)`, `MODE`],
  },
  "inferred-primitive-of-another-kind": {
    when: ["top", "late", "preload", "ahead"],
    module: `export const V = 5000;`,
    mock: `{ V: "ten" }`,
    uses: [`V`, `String(V)`, `typeof V`],
  },
  "inferred-record-in-part": {
    when: ["top", "late", "preload", "ahead"],
    module: `export const V = { url: "real", retries: 3, nested: { on: true } };`,
    mock: `{ V: { url: "mocked" } }`,
    uses: [`V.url`, `V.retries`, `JSON.stringify(V)`, `V.nested?.on`],
  },
  "inferred-record-of-other-kinds": {
    when: ["top", "late", "preload", "ahead"],
    module: `export const V = { url: "real", retries: 3 };`,
    mock: `{ V: { url: 5, retries: "many" } }`,
    uses: [`V.url`, `V.retries`, `JSON.stringify(V)`, `String(V.url) + String(V.retries)`],
  },
  "inferred-list": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V = [1, 2, 3];`, `export const W = ["a", "b"] as const;`].join("\n"),
    mock: `{ V: [9], W: ["z"] }`,
    imports: `import { V, W } from "./a";`,
    uses: [`V.length`, `V[0]`, `V.join()`, `W.length`, `W[0]`, `W.join()`],
  },
  "inferred-let": {
    when: ["top", "late"],
    module: [`export let V = 5;`, `export let W = "real";`].join("\n"),
    mock: `{ V: 6, W: "mocked" }`,
    imports: `import { V, W } from "./a";`,
    uses: [`V`, `V + 1`, `W`, `W.length`],
    own: [`V`, `W`],
  },
  "let-written-after-the-mock": {
    when: ["top", "late"],
    module: [
      `export let V: number = 5;`,
      `export let W: string = "real";`,
      `export function bump(): number { V++; return V; }`,
      `export function set(n: number, w: string): void { V = n; W = w; }`,
    ].join("\n"),
    mock: `{ V: 6, W: "mocked", bump: REALS.bump, set: REALS.set }`,
    imports: `import { V, W, bump, set } from "./a";`,
    uses: [`V`, `bump()`, `V`, `W`, `(set(40, "set"), V)`, `W`, `bump()`, `V + 1`],
    own: [`V`, `W`],
  },
  "annotated-wider-than-stored": {
    when: ["top", "late"],
    module: [
      `export interface Shape { area(): number }`,
      `export class Circle implements Shape { r = 1; area(): number { return 3; } }`,
      `export class Square implements Shape { s = 2; area(): number { return 4; } }`,
      `export const V: Shape = new Circle();`,
      `export const N: number | string = 5;`,
    ].join("\n"),
    mock: `{ V: new REALS.Square(), N: "five", Circle: REALS.Circle, Square: REALS.Square }`,
    imports: `import { V, N } from "./a";`,
    uses: [`V.area()`, `N`, `typeof N`, `JSON.stringify(V)`],
    own: [`V.area()`, `N`],
  },
  "object-with-methods": {
    when: ["top", "late"],
    module: `export const V = { base: "real", get(id: number): string { return this.base + id; }, arrow: (id: number): string => "real arrow " + id };`,
    mock: `{ V: { base: "mocked", get(id: number): string { return this.base + id; }, arrow: (id: number): string => "mocked arrow " + id } }`,
    helpers: [
      `function detached(n: number): string { const { arrow } = V; return arrow(n); }`,
      `const { arrow } = V;`,
      `function const_arrow(n: number): string { return arrow(n); }`,
    ].join("\n"),
    uses: [`V.get(1)`, `V.arrow(1)`, `V.base`, `detached(1)`, `const_arrow(1)`],
    own: [`V.get(1)`, `V.arrow(1)`],
  },
  "object-of-mocks": {
    when: ["top", "late", "preload", "ahead"],
    module: `export const V = { get(id: number): string { return "real" + id; } };`,
    mock: `{ V: { get: mock((id: number) => "mocked" + id) } }`,
    uses: [`V.get(1)`, `(V.get as any).mock?.calls.length`],
  },
  "destructured-exports": {
    when: ["top", "late"],
    module: [
      `const source = { a: 1, b: "real" };`,
      `export const { a, b } = source;`,
      `export const [first, second] = [10, 20];`,
    ].join("\n"),
    mock: `{ a: 2, b: "mocked", first: 11, second: 21 }`,
    imports: `import { a, b, first, second } from "./a";`,
    uses: [`a`, `b`, `first + second`, `a === 1`],
    own: [`a`, `b`, `first`],
  },
  "builtin-in-a-constant": {
    when: ["top", "late", "spied"],
    module: [
      `export const has = Object.prototype.hasOwnProperty;`,
      `export const floor = Math.floor;`,
      `export const V = JSON.stringify;`,
    ].join("\n"),
    mock: `{ has: () => false, floor: () => 42, V: () => "mocked stringify" }`,
    imports: `import { has, floor, V } from "./a";`,
    uses: [`has.call({ a: 1 }, "a")`, `floor(1.5)`, `V([1])`],
    own: [`has.call({ a: 1 }, "a")`, `floor(1.5)`, `V([1])`],
  },
  symbol: {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const V: unique symbol = Symbol("real");`,
      `export const holder = { [V]: "under the real symbol" };`,
    ].join("\n"),
    mock: `{ V: MOCKED_SYMBOL, holder: { [MOCKED_SYMBOL]: "under the mocked symbol" } }`,
    imports: `import { V, holder } from "./a";`,
    uses: [`(holder as any)[V]`, `V.description`],
  },
  "undefined-and-null": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number | undefined = 5;`, `export const W: string | null = "real";`].join("\n"),
    mock: `{ V: undefined, W: null }`,
    imports: `import { V, W } from "./a";`,
    uses: [`V`, `W`, `V ?? "none"`, `W ?? "none"`],
  },
  "renamed-export": {
    when: ["top", "late", "spied"],
    module: [
      `const inner: number = 5;`,
      `function innerF(): string { return "real f"; }`,
      `class InnerC { static s(): string { return "real s"; } }`,
      `enum InnerE { A = 1 }`,
      `export { inner as V, innerF as f, InnerC as C, InnerE as E };`,
    ].join("\n"),
    mock: `{ V: 6, f: () => "mocked f", C: class { static s(): string { return "mocked s"; } }, E: { A: 10 } }`,
    imports: `import { V, f, C, E } from "./a";`,
    uses: [`V`, `V === 5`, `f()`, `C.s()`, `E.A`],
    own: [`inner`, `innerF()`, `InnerC.s()`, `InnerE.A`],
  },
  "renamed-import": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export const V: number = 5;`,
      `export function f(): string { return "real f"; }`,
      `export class C { static s(): string { return "real s"; } }`,
    ].join("\n"),
    mock: `{ V: 6, f: () => "mocked f", C: class { static s(): string { return "mocked s"; } } }`,
    imports: `import { V as W, f as g, C as D } from "./a";`,
    helpers: `class Sub extends D {}`,
    uses: [`W`, `g()`, `D.s()`, `new Sub() instanceof D`],
  },
  "exported-twice": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number = 5;`, `export { V as W };`].join("\n"),
    mock: `{ V: 6, W: 7 }`,
    imports: `import { V, W } from "./a";`,
    uses: [`V`, `W`],
  },
  "default-forms": {
    when: ["top", "late", "preload", "ahead"],
    module: [`const value = { url: "real" };`, `export default value;`, `export const other: number = 1;`].join("\n"),
    mock: `{ default: { url: "mocked" }, other: 2 }`,
    imports: [`import V, { other } from "./a";`, `import * as ns from "./a";`].join("\n"),
    uses: [`V.url`, `other`, `ns.default.url`],
  },
  "default-arrow": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: `export default (n: number): number => n + 1;`,
    mock: `{ default: (n: number) => n + 100 }`,
    imports: `import V from "./a";`,
    helpers: `const kept = V;`,
    uses: [`V(1)`, `[1].map(V).join()`, `kept(1)`],
  },
  "default-named-binding": {
    when: ["top", "late"],
    module: [
      `function inner(n: number): number { return n + 1; }`,
      `export default inner;`,
      `export function viaOwn(n: number): number { return inner(n); }`,
    ].join("\n"),
    mock: `{ default: (n: number) => n + 100, viaOwn: REALS.viaOwn }`,
    imports: `import V, { viaOwn } from "./a";`,
    uses: [`V(1)`, `viaOwn(1)`],
  },
  "star-as": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export const V: number = 5;`,
      `export function f(): string { return "real f"; }`,
      `export class C { static s(): string { return "real s"; } }`,
      `export enum E { A = 1 }`,
    ].join("\n"),
    mock: `{ V: 6, f: () => "mocked f", C: class { static s(): string { return "mocked s"; } }, E: { A: 10 } }`,
    imports: `import { whole } from "./starAs";`,
    uses: [
      `whole.V`,
      `whole.f()`,
      `whole.C.s()`,
      `whole.E.A`,
      `whole.V === 5`,
      `new whole.C() instanceof whole.C`,
      `Object.keys(whole).sort().join()`,
    ],
  },
  "namespace-more": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      `export enum E { A = 1 }`,
    ].join("\n"),
    mock: `{ V: 6, f: (n: number) => n + 100, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } }, E: { A: 10 } }`,
    imports: `import * as ns from "./a";`,
    helpers: [
      `class Sub extends ns.C {}`,
      `const kept = ns.f;`,
      `const { f } = ns;`,
      `function destructured(n: number): number { return f(n); }`,
      `function passed(m: typeof ns): number { return m.f(1); }`,
      `const x = new ns.C();`,
    ].join("\n"),
    uses: [
      `ns.C.s()`,
      `new ns.C().m()`,
      `ns.E.A`,
      `ns.f(...[1])`,
      `[1].map(ns.f).join()`,
      `new Sub().m()`,
      `kept(1)`,
      `destructured(1)`,
      `ns.f?.(1)`,
      `(ns as any).f(1)`,
      `ns["f"](1)`,
      `passed(ns)`,
      `x instanceof ns.C`,
    ],
  },
  "barrel-is-mocked": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number = 5;`, `export function f(): string { return "real f"; }`].join("\n"),
    mock: `{ V: 6, f: () => "mocked f" }`,
    imports: [`import { V, f } from "./middle2";`, `import { V as direct, f as directF } from "./a";`].join("\n"),
    uses: [`V`, `f()`, `direct`, `directF()`],
    target: "./middle2",
  },
  "barrel-through-its-namespace": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number = 5;`, `export function f(): string { return "real f"; }`].join("\n"),
    mock: `{ V: 6, f: () => "mocked f" }`,
    imports: [`import * as m from "./middle2";`, `import * as source from "./a";`].join("\n"),
    uses: [
      `m.V`,
      `m.f()`,
      `({ ...m }).V`,
      `(await import("./middle2")).V`,
      `require("./middle2").V`,
      `Object.keys(m).sort().join()`,
      `source.V`,
      `source.f()`,
      `(await import("./a")).V`,
    ],
    target: "./middle2",
  },
  "barrel-of-a-barrel": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number = 5;`, `export function f(): string { return "real f"; }`].join("\n"),
    mock: `{ V: 6, f: () => "mocked f" }`,
    imports: [
      `import { V, f } from "./outer";`,
      `import { V as inner, f as innerF } from "./middle2";`,
      `import { V as direct, f as directF } from "./a";`,
    ].join("\n"),
    uses: [`V`, `f()`, `inner`, `innerF()`, `direct`, `directF()`],
    target: "./middle2",
    files: {
      "outer.ts": [`export * from "./middle2";`, ``].join("\n"),
    },
  },
  "star-barrel-is-mocked": {
    when: ["top", "late", "preload", "ahead"],
    module: [`export const V: number = 5;`, `export function f(): string { return "real f"; }`].join("\n"),
    mock: `{ V: 6, f: () => "mocked f" }`,
    imports: [`import { V, f } from "./star";`, `import { V as direct, f as directF } from "./a";`].join("\n"),
    uses: [`V`, `f()`, `direct`, `directF()`],
    target: "./star",
  },
  "names-the-mock-leaves-out": {
    when: ["top", "late"],
    module: [
      `export const V: number = 5;`,
      `export function f(): string { return "real f"; }`,
      `export class C { static s(): string { return "real s"; } }`,
    ].join("\n"),
    mock: `{ V: 6 }`,
    imports: `import { V, f, C } from "./a";`,
    uses: [`V`, `f()`, `C.s()`],
  },
  "names-the-mock-adds": {
    when: ["top", "late"],
    module: `export const V: number = 5;`,
    mock: `{ V: 6, added: "added" }`,
    imports: [`import { V } from "./a";`, `import * as ns from "./a";`].join("\n"),
    uses: [`V`, `(ns as any).added`, `Object.keys(ns).sort().join()`],
  },
  "through-two-files": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export const V: number = 5;`,
      `export function f(): string { return "real f"; }`,
      `export class C { static s(): string { return "real s"; } }`,
      `export enum E { A = 1 }`,
    ].join("\n"),
    mock: `{ V: 6, f: () => "mocked f", C: class { static s(): string { return "mocked s"; } }, E: { A: 10 } }`,
    imports: `import { V, f, C, E } from "./outer";`,
    helpers: [`class Sub extends C {}`, `const kept = f;`].join("\n"),
    uses: [`V`, `V === 5`, `f()`, `C.s()`, `E.A`, `new Sub() instanceof C`, `kept()`],
    files: {
      "inner.ts": [`export { V, f, C, E } from "./a";`, ``].join("\n"),
      "outer.ts": [`export * from "./inner";`, ``].join("\n"),
    },
  },
  "used-by-a-third-module": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [`export function V(n: number): number { return n + 1; }`, `export const N: number = 5;`].join("\n"),
    mock: `{ V: (n: number) => n + 100, N: 6 }`,
    imports: `import { loop, Holder, byDefault, table, late } from "./third";`,
    uses: [
      `loop()`,
      `new Holder().v`,
      `new Holder().w`,
      `byDefault()`,
      `Holder.s`,
      `table.n`,
      `table.f(1)`,
      `late().n`,
    ],
    files: {
      "third.ts": [
        `import { V, N } from "./a";`,
        `export function loop(): number { let s = 0; for (let i = 0; i < 100; i++) s += V(i); return s; }`,
        `export class Holder { v = V(1); static s = N; constructor(public w: number = V(2)) {} }`,
        `export function byDefault(n: number = V(3)): number { return n + N; }`,
        `export const table = { n: N, f: V };`,
        `export function late(): { n: number } { return { n: N }; }`,
        ``,
      ].join("\n"),
    },
  },
  "record-with-getters": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export interface Config { url: string; retries: number }`,
      `export const V: Config = { url: "real", retries: 3 };`,
    ].join("\n"),
    mock: `{ V: { get url() { return "mocked by a getter"; }, get retries() { return 9; } } }`,
    imports: [`import { V } from "./a";`, `import type { Config } from "./a";`].join("\n"),
    helpers: `function takes(c: Config): string { return c.url + c.retries; }`,
    uses: [`V.url`, `V.retries + 1`, `JSON.stringify(V)`, `takes(V)`, `({ ...V }).url`],
  },
  "lazy-a-function-in-a-literal": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.run()`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = { run: helper };`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-an-object-in-a-literal": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.x.a`],
    files: {
      "made.ts": [`import { KEY, X, helper, Real, Level } from "./a";`, `export const made = { x: X };`, ``].join("\n"),
    },
  },
  "lazy-a-string-in-a-literal": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.key`],
    files: {
      "made.ts": [`import { KEY, X, helper, Real, Level } from "./a";`, `export const made = { key: KEY };`, ``].join(
        "\n",
      ),
    },
  },
  "lazy-a-class-in-a-list": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`new made[0]().name()`],
    files: {
      "made.ts": [`import { KEY, X, helper, Real, Level } from "./a";`, `export const made = [Real];`, ``].join("\n"),
    },
  },
  "lazy-a-map": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`[...made.keys()].join()`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = new Map<string, number>([[KEY, 1]]);`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-a-frozen-literal": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.key`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = Object.freeze({ key: KEY });`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-what-a-function-makes": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.key`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `function wrap(key: string) { return { key }; }`,
        `export const made = wrap(KEY);`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-read-by-a-function-alone": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.read()`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `const hidden = { key: KEY };`,
        `export const made = { read(): string { return hidden.key; } };`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-an-enum-member-in-a-literal": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.level`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = { level: Level.Low };`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-a-class-that-extends": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`new made.Sub().name()`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = { Sub: class extends Real {} };`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-an-instance": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.it.name()`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = { it: new Real() };`,
        ``,
      ].join("\n"),
    },
  },
  "lazy-what-a-call-returns": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export const KEY: string = "real";`,
      `export const X = { a: 1 };`,
      `export function helper(): string { return "real"; }`,
      `export class Real { name(): string { return "real"; } }`,
      `export enum Level { Low = 1 }`,
    ].join("\n"),
    mock: `{ KEY: "mocked", X: { a: 2 }, helper: () => "mocked", Real: class { name(): string { return "mocked"; } }, Level: { Low: 10 } }`,
    imports: `import { made } from "./made";`,
    uses: [`made.text`],
    files: {
      "made.ts": [
        `import { KEY, X, helper, Real, Level } from "./a";`,
        `export const made = { text: helper() };`,
        ``,
      ].join("\n"),
    },
  },
  "json-module": {
    when: ["top", "late", "preload", "ahead"],
    mock: `{ default: { url: "mocked", n: 2 }, url: "mocked", n: 2 }`,
    imports: `import data from "./data.json";`,
    helpers: `const kept = data.url;`,
    uses: [`data.url`, `data.n + 1`, `JSON.stringify(data)`, `data.url === "real"`, `kept`],
    target: "./data.json",
    files: {
      "data.json": [`{ "url": "real", "n": 1 }`, ``].join("\n"),
      "tsconfig.json": [
        `{ "compilerOptions": { "resolveJsonModule": true, "strict": true, "module": "esnext", "moduleResolution": "bundler" } }`,
        ``,
      ].join("\n"),
    },
  },
  "commonjs-module": {
    when: ["top", "late", "preload", "ahead"],
    mock: `{ V: 6, f: () => "mocked f" }`,
    imports: [`import { V, f } from "./lib.cjs";`, `const required = require("./lib.cjs");`].join("\n"),
    uses: [`V`, `f()`, `required.V`, `required.f()`, `V === 5`],
    target: "./lib.cjs",
    files: {
      "lib.cjs": [`exports.V = 5;`, `exports.f = function () { return "real f"; };`, ``].join("\n"),
    },
  },
  "commonjs-module-made-at-run-time": {
    when: ["top", "late", "preload", "ahead"],
    mock: `{ V: 6, f: () => "mocked f", default: { V: 6, f: () => "mocked f of default" } }`,
    imports: [
      `import { V, f } from "./lib.cjs";`,
      `import whole from "./lib.cjs";`,
      `const required = require("./lib.cjs");`,
    ].join("\n"),
    uses: [`V`, `f()`, `required.V`, `required.f()`, `V === 5`, `whole.f()`],
    target: "./lib.cjs",
    files: {
      "lib.cjs": [
        `function make() { var made = {}; made.V = 5; made.f = function () { return "real f"; }; return made; }`,
        `module.exports = make();`,
        ``,
      ].join("\n"),
    },
  },
  "package-by-its-name": {
    when: ["top", "late", "preload", "ahead"],
    mock: `{ V: 6, f: () => "mocked f", C: class { static s() { return "mocked s"; } } }`,
    imports: [`import { V, f, C } from "fake-package";`, `import { viaOther } from "./other";`].join("\n"),
    helpers: `const kept = f;`,
    uses: [`V`, `V === 5`, `f()`, `C.s()`, `kept()`, `viaOther()`],
    target: "fake-package",
    files: {
      "node_modules/fake-package/package.json": [
        `{ "name": "fake-package", "version": "1.0.0", "type": "module", "main": "index.js" }`,
        ``,
      ].join("\n"),
      "node_modules/fake-package/index.js": [
        `export const V = 5;`,
        `export function f() { return "real f"; }`,
        `export class C { static s() { return "real s"; } }`,
        ``,
      ].join("\n"),
      "node_modules/fake-package/index.d.ts": [
        `export const V: number;`,
        `export function f(): string;`,
        `export class C { static s(): string; }`,
        ``,
      ].join("\n"),
      "other.ts": [`import { f } from "fake-package";`, `export function viaOther(): string { return f(); }`, ``].join(
        "\n",
      ),
    },
  },
  "this-of-a-call-through-a-namespace": {
    when: ["top", "late", "preload", "ahead"],
    module: [
      `export function f(): string { return "real f"; }`,
      `export const g = function (): string { return "real g"; };`,
    ].join("\n"),
    mock: `{ f: function (this: unknown) { return "mocked f, this: " + (this === undefined ? "undefined" : typeof this); }, g: function (this: unknown) { return "mocked g, this: " + (this === undefined ? "undefined" : typeof this); } }`,
    imports: [`import * as ns from "./a";`, `import { f } from "./a";`].join("\n"),
    uses: [`ns.f()`, `ns.g()`, `f()`, `(0, ns.f)()`, `ns["f"]()`],
  },
  jsx: {
    when: ["top", "late", "preload", "ahead"],
    module: `export function V(props: { n: number }): { tag: string; n: number } { return { tag: "real", n: props.n }; }`,
    mock: `{ V: (props: { n: number }) => ({ tag: "mocked", n: props.n }) }`,
    uses: [`JSON.stringify((<V n={1} /> as any).type({ n: 1 }))`, `(<V n={1} /> as any).type === V`],
    extension: "tsx",
    files: {
      "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "./rt", "strict": true } }`,
      "rt/jsx-runtime.ts": [
        `export function jsx(type: unknown, props: unknown): unknown { return { type, props }; }`,
        `export const jsxs = jsx;`,
        `export const Fragment = "fragment";`,
        `export namespace JSX { export interface IntrinsicElements { [name: string]: unknown } export type Element = unknown; }`,
        ``,
      ].join("\n"),
      "rt/jsx-dev-runtime.ts": [
        `export function jsxDEV(type: unknown, props: unknown): unknown { return { type, props }; }`,
        `export const Fragment = "fragment";`,
        `export namespace JSX { export interface IntrinsicElements { [name: string]: unknown } export type Element = unknown; }`,
        ``,
      ].join("\n"),
    },
  },
  "javascript-user": {
    when: ["top", "late", "spied", "preload", "ahead"],
    module: [
      `export const V: number = 5;`,
      `export function f(): string { return "real f"; }`,
      `export class C { static s(): string { return "real s"; } }`,
      `export enum E { A = 1 }`,
    ].join("\n"),
    mock: `{ V: 6, f: () => "mocked f", C: class { static s(): string { return "mocked s"; } }, E: { A: 10 } }`,
    imports: `import { fromJs } from "./plain.js";`,
    uses: [`fromJs()`],
    files: {
      "plain.js": [
        `import { V, f, C, E } from "./a";`,
        `class Sub extends C {}`,
        `const kept = f;`,
        `export function fromJs() { return [V, V === 5, f(), C.s(), E.A, Sub.s(), kept()].join(); }`,
        ``,
      ].join("\n"),
    },
  },
  "javascript-module": {
    when: ["top", "late", "spied", "preload", "ahead"],
    mock: `{ V: 6, f: () => "mocked f", C: class { static s() { return "mocked s"; } } }`,
    imports: `import { V, f, C } from "./lib.js";`,
    helpers: [`class Sub extends C {}`, `const kept = f;`].join("\n"),
    uses: [`V`, `V === 5`, `f()`, `C.s()`, `new Sub() instanceof C`, `kept()`],
    target: "./lib.js",
    files: {
      "lib.js": [
        `export const V = 5;`,
        `export function f() { return "real f"; }`,
        `export class C { static s() { return "real s"; } }`,
        ``,
      ].join("\n"),
    },
  },
};

const ways: Record<string, Record<string, string>> = {
  "spy-on-the-namespace": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { console.log(all()); const s = spyOn(a, "f").mockImplementation((n: number) => n + 100); console.log(all(), s.mock.calls.length); s.mockRestore(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-that-calls-through": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { const s = spyOn(a, "f"); console.log(all(), s.mock.calls.length); s.mockRestore(); console.log(all(), s.mock.calls.length); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-a-class-of-the-namespace": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { const s = spyOn(a as any, "C").mockImplementation(function () { return { m: () => "spied m" }; } as any); try { console.log(all()); } catch (e) { console.log("THROWS", (e as Error).name); } console.log(new a.C().m()); s.mockRestore(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-and-restore-all": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { spyOn(a, "f").mockReturnValue(7); console.log(all()); mock.restore(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-return-value-once": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { spyOn(a, "f").mockReturnValueOnce(7); console.log(all()); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "mocked-twice": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", () => { mock.module("./a", () => ({ ...a, f: (n: number) => n + 100 })); console.log(all()); mock.module("./a", () => ({ ...a, f: (n: number) => n + 200 })); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "mock-keeps-the-rest": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `const real = { ...a };`,
      `test("case", () => { mock.module("./a", () => ({ ...real, f: (n: number) => n + 100 })); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "mock-put-back-by-hand": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `const real = { ...a };`,
      `test("case", () => { mock.module("./a", () => ({ ...real, f: (n: number) => n + 100, V: 6 })); console.log(all()); mock.module("./a", () => real); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "async-factory": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("case", async () => { await mock.module("./a", async () => ({ V: 6, f: (n: number) => n + 100, viaOwn: a.viaOwn, C: a.C })); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "jest-mock": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `// @ts-ignore`,
      `jest.mock("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "by-absolute-path": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `mock.module(import.meta.dir + "/a.ts", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "by-a-js-extension": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `mock.module("./a.js", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "from-a-folder-below": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "deep/er/helper.ts": [
      `import { mock } from "bun:test";`,
      `export function lay(): void { mock.module("../../a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } })); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import { lay } from "./deep/er/helper";`,
      `test("case", () => { console.log(all()); lay(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "an-index-file": {
    "lib/index.ts": [`export function g(): string { return "real g"; }`, ``].join("\n"),
    "uses-lib.ts": [`import { g } from "./lib/index";`, `export function viaLib(): string { return g(); }`, ``].join(
      "\n",
    ),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { viaLib } from "./uses-lib";`,
      `mock.module("./lib", () => ({ g: () => "mocked g" }));`,
      `test("case", () => { console.log(viaLib()); });`,
      ``,
    ].join("\n"),
  },
  "a-spy-records-this": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as ns from "./a";`,
      `test("case", () => { const spy = spyOn(ns, "f"); console.log(ns.f(1), spy.mock.contexts.length, spy.mock.contexts[0] === ns, spy.mock.contexts[0] === undefined); console.log(all()); console.log(spy.mock.contexts.map((context: unknown) => context === undefined ? "undefined" : context === ns ? "ns" : typeof context).join()); });`,
      ``,
    ].join("\n"),
  },
  "beside-a-local-variable-named-mock": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "holds.ts": [
      `export function held(): string { const mock = { a: 1 }; const spyOn = [mock]; const jest = spyOn; return JSON.stringify([mock, jest]); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import { held } from "./holds";`,
      `mock.module("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all(), held()); });`,
      ``,
    ].join("\n"),
  },
  "handed-on-as-a-value": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `const lay = (how: typeof mock) => how.module("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); lay(mock); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-what-require-hands-out": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `test("case", () => { spyOn(require("./a"), "f").mockReturnValue(700); console.log(all()); mock.restore(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "by-a-computed-name": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `const name = ["./a"][0];`,
      `mock.module(name, () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "mock-under-another-name": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `const lay = mock.module;`,
      `lay("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "in-before-each": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `import { beforeEach } from "bun:test";`,
      `let turn = 0;`,
      `beforeEach(() => { turn++; const by = turn * 100; mock.module("./a", () => ({ ...a, f: (n: number) => n + by })); });`,
      `test("one", () => { console.log(all()); });`,
      `test("two", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "two-test-files": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "second.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `test("second file", () => { console.log(all()); });`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `test("first file", () => { mock.module("./a", () => ({ ...a, f: (n: number) => n + 100 })); console.log(all()); });`,
      ``,
    ].join("\n"),
    "flags.txt": `./second.test.ts`,
  },
  "a-helper-lays-the-mock": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "helper.ts": [
      `import { mock } from "bun:test";`,
      `export function layMock(): void { mock.module("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } })); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as a from "./a";`,
      `import { layMock } from "./helper";`,
      `test("case", () => { console.log(all()); layMock(); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "required-after-the-mock": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `mock.module("./a", () => ({ V: 6, f: (n: number) => n + 100, viaOwn: (n: number) => n, C: class { static s(): string { return "mocked s"; } m(): string { return "mocked m"; } } }));`,
      `test("case", () => { const { all } = require("./user") as typeof import("./user"); console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-date-now": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const s = spyOn(Date, "now").mockReturnValue(1000); console.log(clock.now(), clock.viaKept(), clock.stamp(), clock.passed(), clock.elapsed(400), nowFromJs(), Date.now(), s.mock.calls.length, clock.parsed()); expect(Date.now).toHaveBeenCalled(); console.log(spyOn(Date, "now") === s, Date.now === s); s.mockRestore(); console.log(clock.now() > 1_000_000, nowFromJs() > 1_000_000, Date.now === s); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-math-random": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const s = jest.spyOn(Math, "random").mockReturnValue(0.5); console.log(clock.roll(), rollFromJs(), Math.random(), s.mock.calls.length, clock.largest()); mock.restore(); console.log(clock.roll() < 6, Math.random() < 1); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-date-now-with-an-implementation": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { let t = 0; spyOn(Date, "now").mockImplementation(() => (t += 10)); console.log(clock.now(), clock.now(), clock.elapsed(0)); mock.restore(); console.log(clock.now() > 1_000_000); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-math-random-with-using": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { { using _random = spyOn(Math, "random").mockReturnValue(0.5); console.log(clock.roll(), Math.random()); } console.log(clock.roll() < 6, Math.random() !== 0.5 || Math.random() !== 0.5); { using _now = spyOn(Date, "now").mockReturnValue(7); console.log(clock.now(), Date.now()); } console.log(clock.now() > 1_000_000); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-an-export-with-using": {
    "a.ts": [
      `export const V: number = 5;`,
      `export function f(n: number): number { return n + 1; }`,
      `export function viaOwn(n: number): number { return f(n) * 2; }`,
      `export class C { static s(): string { return "real s"; } m(): string { return "real m"; } }`,
      ``,
    ].join("\n"),
    "user.ts": [
      `import { V, f, C, viaOwn } from "./a";`,
      `const kept = f;`,
      `class Sub extends C {}`,
      `export function all(): string { return [V, V === 5, f(1), f(...[1]), kept(1), viaOwn(1), C.s(), new C().m(), Sub.s(), new Sub().m()].join(); }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import { all } from "./user";`,
      `import * as ns from "./a";`,
      `test("case", () => { console.log(all()); { using _f = spyOn(ns, "f").mockReturnValue(700); console.log(all()); } console.log(all()); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-string-prototype-normalize": {
    "texts.ts": [
      `export function plain(s: string): string { return s.normalize("NFC"); }`,
      `export function maybe(s?: string): string | undefined { return s?.normalize(); }`,
      `export function where(s: string, list: string[]): string { return s.indexOf("b") + "," + list.indexOf("b"); }`,
      `export function byPath(s: string): string { return String.prototype.normalize.call(s); }`,
      `export function own(o: { normalize(): string }): string { return o.normalize(); }`,
      `export function sorted(list: string[]): string { return [...list].sort((a, b) => a.localeCompare(b)).join(); }`,
      `export function got(m: Map<string, number>): number | undefined { return m.get("a"); }`,
      `export function iso(d: Date): string { return d.toISOString(); }`,
      ``,
    ].join("\n"),
    "untyped.js": [`export function plainFromJs(s) { return s.normalize(); }`, ``].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as texts from "./texts";`,
      `import { plainFromJs } from "./untyped.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const s = spyOn(String.prototype, "normalize"); console.log(texts.plain("a"), texts.maybe("b"), texts.maybe(), plainFromJs("c"), texts.byPath("d"), texts.own({ normalize: () => "own" }), "e".normalize(), s.mock.calls.length, JSON.stringify(s.mock.calls), s.mock.contexts.join()); expect(s).toHaveBeenCalledTimes(5); s.mockRestore(); console.log(texts.plain("a"), s.mock.calls.length); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-string-prototype-normalize-with-a-value": {
    "texts.ts": [
      `export function plain(s: string): string { return s.normalize("NFC"); }`,
      `export function maybe(s?: string): string | undefined { return s?.normalize(); }`,
      `export function where(s: string, list: string[]): string { return s.indexOf("b") + "," + list.indexOf("b"); }`,
      `export function byPath(s: string): string { return String.prototype.normalize.call(s); }`,
      `export function own(o: { normalize(): string }): string { return o.normalize(); }`,
      `export function sorted(list: string[]): string { return [...list].sort((a, b) => a.localeCompare(b)).join(); }`,
      `export function got(m: Map<string, number>): number | undefined { return m.get("a"); }`,
      `export function iso(d: Date): string { return d.toISOString(); }`,
      ``,
    ].join("\n"),
    "untyped.js": [`export function plainFromJs(s) { return s.normalize(); }`, ``].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as texts from "./texts";`,
      `import { plainFromJs } from "./untyped.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { { using _s = spyOn(String.prototype, "normalize").mockReturnValue("spied"); console.log(texts.plain("a"), texts.maybe("b"), plainFromJs("c"), texts.byPath("d"), texts.own({ normalize: () => "own" })); } console.log(texts.plain("a"), plainFromJs("c")); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-one-of-two-prototypes-with-the-name": {
    "texts.ts": [
      `export function plain(s: string): string { return s.normalize("NFC"); }`,
      `export function maybe(s?: string): string | undefined { return s?.normalize(); }`,
      `export function where(s: string, list: string[]): string { return s.indexOf("b") + "," + list.indexOf("b"); }`,
      `export function byPath(s: string): string { return String.prototype.normalize.call(s); }`,
      `export function own(o: { normalize(): string }): string { return o.normalize(); }`,
      `export function sorted(list: string[]): string { return [...list].sort((a, b) => a.localeCompare(b)).join(); }`,
      `export function got(m: Map<string, number>): number | undefined { return m.get("a"); }`,
      `export function iso(d: Date): string { return d.toISOString(); }`,
      ``,
    ].join("\n"),
    "untyped.js": [`export function plainFromJs(s) { return s.normalize(); }`, ``].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as texts from "./texts";`,
      `import { plainFromJs } from "./untyped.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const s = spyOn(String.prototype, "indexOf").mockReturnValue(40); console.log(texts.where("abc", ["a", "b"]), s.mock.calls.length); const l = spyOn(Array.prototype, "indexOf").mockReturnValue(50); console.log(texts.where("abc", ["a", "b"]), s.mock.calls.length, l.mock.calls.length); mock.restore(); console.log(texts.where("abc", ["a", "b"])); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-other-prototypes": {
    "texts.ts": [
      `export function plain(s: string): string { return s.normalize("NFC"); }`,
      `export function maybe(s?: string): string | undefined { return s?.normalize(); }`,
      `export function where(s: string, list: string[]): string { return s.indexOf("b") + "," + list.indexOf("b"); }`,
      `export function byPath(s: string): string { return String.prototype.normalize.call(s); }`,
      `export function own(o: { normalize(): string }): string { return o.normalize(); }`,
      `export function sorted(list: string[]): string { return [...list].sort((a, b) => a.localeCompare(b)).join(); }`,
      `export function got(m: Map<string, number>): number | undefined { return m.get("a"); }`,
      `export function iso(d: Date): string { return d.toISOString(); }`,
      ``,
    ].join("\n"),
    "untyped.js": [`export function plainFromJs(s) { return s.normalize(); }`, ``].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as texts from "./texts";`,
      `import { plainFromJs } from "./untyped.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const c = spyOn(String.prototype, "localeCompare"); const g = spyOn(Map.prototype, "get").mockReturnValue(9); const i = spyOn(Date.prototype, "toISOString").mockReturnValue("spied"); console.log(texts.sorted(["b", "a", "c"]), c.mock.calls.length > 0, texts.got(new Map([["a", 1]])), texts.iso(new Date(0))); mock.restore(); console.log(texts.sorted(["b", "a"]), texts.got(new Map([["a", 1]])), texts.iso(new Date(0))); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-date-now-read-in-other-ways": {
    "aliases.ts": [
      `const D = Date;`,
      `export function byAlias(): number { return D.now(); }`,
      `export function taken(): number { const { now } = Date; return now(); }`,
      `export function byKey(): number { return Date["now"](); }`,
      `export function byComputedKey(key: "now"): number { return Date[key](); }`,
      `export function reflected(): number { return Reflect.get(Date, "now")(); }`,
      `export function handed(holder: { now(): number }): number { return holder.now(); }`,
      `export function described(): boolean { return typeof Object.getOwnPropertyDescriptor(Date, "now")!.value === "function"; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as aliases from "./aliases";`,
      `test("case", () => { const s = spyOn(Date, "now").mockReturnValue(1000); console.log(aliases.byAlias(), aliases.taken(), aliases.byKey(), aliases.byComputedKey("now"), aliases.reflected(), aliases.handed(Date), aliases.described(), Date.now === s, s.mock.calls.length); s.mockRestore(); console.log(aliases.byAlias() > 1_000_000, aliases.taken() > 1_000_000, aliases.byKey() > 1_000_000, aliases.handed(Date) > 1_000_000, Date.now === s); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-a-global-by-way-of-global-this": {
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `test("case", () => { try { const s = spyOn(globalThis, "encodeURIComponent").mockReturnValue("spied"); console.log(encodeURIComponent("a b"), globalThis.encodeURIComponent("a b"), s.mock.calls.length); } catch (e) { console.log("THROWS", (e as Error).name); } mock.restore(); console.log(encodeURIComponent("a b")); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-date-now-that-calls-through": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { const s = spyOn(Date, "now"); console.log(clock.now() > 1_000_000, s.mock.calls.length); s.mockRestore(); });`,
      ``,
    ].join("\n"),
  },
  "spy-on-date-now-in-before-each": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `import { beforeEach, afterEach } from "bun:test";`,
      `beforeEach(() => { spyOn(Date, "now").mockReturnValue(5); });`,
      `afterEach(() => { mock.restore(); });`,
      `test("one", () => { console.log(clock.now()); });`,
      `test("two", () => { console.log(clock.now(), clock.elapsed(1)); });`,
      ``,
    ].join("\n"),
  },
  "no-spy-on-a-builtin": {
    "clock.ts": [
      `export function now(): number { return Date.now(); }`,
      `export function roll(): number { return Math.floor(Math.random() * 6); }`,
      `const kept = Date.now;`,
      `export function viaKept(): boolean { return kept() > 1_000_000; }`,
      `export function stamp(): string { return new Date(Date.now()).toISOString(); }`,
      `export function passed(): number { return [0].map(Date.now)[0]; }`,
      `export function elapsed(since: number): number { return Date.now() - since; }`,
      `export function parsed(): number { return Date.parse("2001-02-03T04:05:06.000Z"); }`,
      `export function largest(): number { return Math.max(1, 2); }`,
      ``,
    ].join("\n"),
    "plain.js": [
      `export function nowFromJs() { return Date.now(); }`,
      `export function rollFromJs() { return Math.random() * 2; }`,
      ``,
    ].join("\n"),
    "main.test.ts": [
      `import { test, mock, spyOn, jest } from "bun:test";`,
      `import * as clock from "./clock";`,
      `import { nowFromJs, rollFromJs } from "./plain.js";`,
      `import { expect } from "bun:test";`,
      `test("case", () => { console.log(clock.now() > 1_000_000, clock.roll() < 6, clock.viaKept(), clock.parsed(), clock.largest()); });`,
      ``,
    ].join("\n"),
  },
};

const show = [
  `const show = (v: unknown): string => typeof v === "bigint" ? v + "n" : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);`,
  `async function row(who: string, i: number, text: string, f: () => unknown): Promise<void> { try { console.log(who, i, text, "=>", show(await f())); } catch (e) { console.log(who, i, text, "THROWS", (e as Error).name, (e as Error).message.includes("(bun compile") ? (e as Error).message.slice(0, 60) : ""); } }`,
  ``,
].join("\n");

const header = `import { test, mock, spyOn, jest } from "bun:test";\n`;

function rows(who: string, uses: string[]): string {
  return uses.map((use, i) => `  await row("${who}", ${i}, ${JSON.stringify(use)}, async () => ${use});\n`).join("");
}

function filesOf(kind: Kind, when: When): Record<string, string> {
  const {
    module = "",
    imports = `import { V } from "./a";`,
    helpers = "",
    own = [],
    ownHelpers = "",
    extension = "ts",
    target = "./a",
  } = kind;
  const files: Record<string, string> = { ...kind.files };
  files["user." + extension] =
    imports +
    "\n" +
    helpers +
    "\n" +
    show +
    "export async function all(): Promise<void> {\n" +
    rows("user", kind.uses) +
    "}\n";
  if (module)
    files["a.ts"] =
      module +
      "\n" +
      (own.length
        ? ownHelpers + "\n" + show + "export async function own(): Promise<void> {\n" + rows("own", own) + "}\n"
        : "");
  const named = imports + module + `"${target}"`;
  if (named.includes(`./middle"`)) files["middle.ts"] = `export { V } from "./a";\n`;
  if (named.includes(`./middle2"`)) files["middle2.ts"] = `export { V, f } from "./a";\n`;
  if (named.includes(`./star"`)) files["star.ts"] = `export * from "./a";\n`;
  if (named.includes(`./starAs"`)) files["starAs.ts"] = `export * as whole from "./a";\n`;
  if (named.includes(`./empty"`)) files["empty.ts"] = `export const nothing = 0;\n`;
  const symbol = kind.mock.includes("MOCKED_SYMBOL") ? `const MOCKED_SYMBOL = Symbol("mocked");\n` : "";
  const keeps = own.length > 0 || kind.mock.includes("REALS");
  const reals = keeps ? `import * as REALS_NS from "${target}";\nconst REALS = { ...REALS_NS };\n` : "";
  const factory = own.length ? kind.mock.slice(0, -1).trimEnd() + ", own: REALS.own }" : kind.mock;
  const callOwn = own.length ? " await REALS.own();" : "";
  const lay = `mock.module("${target}", () => (${factory}));`;
  const user = `import { all } from "./user";\n`;
  switch (when) {
    case "top":
      files["main.test.ts"] =
        header + user + reals + symbol + lay + `\ntest("case", async () => { await all();${callOwn} });\n`;
      break;
    case "late":
      files["main.test.ts"] =
        header +
        user +
        reals +
        symbol +
        `test("case", async () => { await all();${callOwn} console.log("--- the mock is laid"); ${lay} await all();${callOwn} });\n`;
      break;
    case "spied":
      files["main.test.ts"] =
        header +
        user +
        reals +
        `import * as SPIED from "${target}";\n` +
        symbol +
        `test("case", async () => { const own = (SPIED as any).own; const by: Record<string, unknown> = ${kind.mock}; for (const key of Object.keys(by)) if (typeof by[key] === "function") spyOn(SPIED as any, key).mockImplementation(by[key] as any); await all(); if (own) await own(); console.log("--- the spies are lifted"); mock.restore(); await all(); if (own) await own(); });\n`;
      break;
    case "preload":
      files["pre.ts"] = `import { mock } from "bun:test";\n` + symbol + lay + "\n";
      files["flags.txt"] = "--preload ./pre.ts";
      files["main.test.ts"] = header + user + `test("case", async () => { await all(); });\n`;
      break;
    case "ahead":
      files["main.test.ts"] =
        header +
        symbol +
        lay +
        `\ntest("case", async () => { const { all } = await import("./user"); await all(); });\n`;
      break;
  }
  return files;
}

const cases: Record<string, Record<string, string>> = {};
for (const [name, kind] of Object.entries(kinds))
  for (const when of kind.when) cases[name + ", " + when] = filesOf(kind, when);
for (const [name, files] of Object.entries(ways)) cases[name] = files;

async function printed(cwd: string, args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  const noise =
    /^bun test v|^Ran \d+ tests? across|^\s+at |^\s*\d+ \| |^\s+\^|^note: |^warn: |^\S+\(\d+,\d+\): warning TS\d+: /;
  const lines = (stdout + "\n" + stderr)
    .split("\n")
    .map(line => line.replace(/ \[\d+(\.\d+)?m?s\]$/, ""))
    .filter(line => line !== "" && !noise.test(line));
  return { lines, exitCode };
}

test.concurrent.each(Object.keys(cases))(
  "bun test --aot prints what bun test prints: %s",
  async name => {
    const { "flags.txt": flags, ...files } = cases[name];
    using dir = tempDir("mocked-exports", files);
    const rest = [...(flags ? flags.split(" ") : []), "./main.test.ts"];
    const plain = await printed(String(dir), ["test", ...rest]);
    expect(plain.lines.length).toBeGreaterThan(0);
    expect(await printed(String(dir), ["test", "--aot", ...rest])).toEqual(plain);
  },
  240_000,
);
