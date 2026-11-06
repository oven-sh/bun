// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Nothing calls any of these: one function, constant or class of every kind the language has, some exported from a file of which another name is used. The build has to cope with leaving each of them out, and what is used still works.
import { used } from "./kinds";

function plain(a: number, b = a + 1, ...rest: number[]) { return a + b + rest.length; }
async function asynchronous() { await null; return 1; }
function* generator() { const sent: number = yield 1; yield* [sent]; return 2; }
async function* asyncGenerator() { for await (const value of [1]) yield value; }
const arrow = () => 1;
const asyncArrow = async () => { await using resource = { async [Symbol.asyncDispose]() {} }; return resource; };
const expression = function named(): unknown { return named; };
const generatorExpression = function* () { yield 1; };
function usesArguments() { return arguments.length + (new.target ? 1 : 0); }
function usesThis(this: { value: number }) { return this.value; }
function destructures({ a, b: [c = 1, ...d] = [] }: { a: number; b?: number[] }, [e]: number[] = []) { return a + c + d.length + e; }
function controlFlow(n: number): string {
  outer: for (let i = 0; i < n; i++) {
    switch (i) {
      case 1: continue outer;
      case 2: break outer;
      default:
        try { if (i > 5) throw new Error("x"); } catch ({ message }: any) { return message; } finally { n--; }
    }
  }
  do n++; while (n < 3);
  return `${n}`;
}
function nests() {
  class Inner { #secret = 1; static count = 0; get secret() { return this.#secret; } static { Inner.count++; } }
  enum Local { A, B }
  const closure = () => () => new Inner().secret + Local.B;
  function hoisted() { return closure()(); }
  return hoisted();
}
function overloaded(a: number): number;
function overloaded(a: string): string;
function overloaded(a: any) { return a; }
function generic<T extends { length: number }>(value: T): T["length"] { return value.length; }
function asserts(value: unknown): asserts value is string { if (typeof value !== "string") throw new TypeError(); }

class Base {
  field = [1, 2].map(n => n * 2);
  #hidden = () => this.field;
  constructor(public property = 1, protected readonly other?: string) {}
  method() { return this.#hidden(); }
  get accessor() { return this.property; }
  set accessor(value) { this.property = value; }
  static create() { return new this(); }
  static get label() { return "base"; }
  async later() { return this; }
  *each() { yield* this.field; }
  async *stream() { yield this.property; }
  #privateMethod() { return 1; }
  get #privateAccessor() { return this.#privateMethod(); }
  callsPrivate() { return this.#privateAccessor; }
  "quoted name"() { return 1; }
  123() { return 1; }
}
class Derived extends Base {
  extra: number;
  constructor() { super(2); this.extra = super.method().length; }
  override method() { return super.method().concat(this.extra); }
  static override create() { return super.create(); }
}
abstract class Abstract {
  abstract must(): number;
  concrete() { return this.must(); }
}
class WithoutConstructor extends Abstract { must() { return 1; } }
class OnlyFields { a = 1; b = () => this.a; declare c: number; d?: string; }
class Empty {}

console.log(used());

// FILE: kinds.ts
export function used() { return "used"; }
export function plain() { return 1; }
export async function asynchronous() { return 1; }
export function* generator() { yield 1; }
export async function* asyncGenerator() { yield 1; }
export const arrow = () => 1;
export const expression = function () { return 1; };
export class Klass { constructor(public a = 1) {} method() { return this.a; } static make() { return new Klass(); } get b() { return 1; } }
export class Sub extends Klass { constructor() { super(2); } override method() { return super.method(); } }
export default class Default { method() { return 1; } }
export abstract class Shape { abstract area(): number; describe() { return this.area(); } }
function notExported() { return plain() + new Klass().method(); }
const alsoNot = async () => notExported();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: plain asynchronous usesArguments
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=LeftOutOfExecutable name="plain"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asynchronous"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewRuntimeError runtimeError=LeftOutOfExecutable name="asynchronous"
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="usesArguments"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=LeftOutOfExecutable name="usesArguments"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
