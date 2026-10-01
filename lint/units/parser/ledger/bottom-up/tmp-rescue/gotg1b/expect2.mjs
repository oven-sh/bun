const t = new Bun.Transpiler({ loader: "ts" });
const td = new Bun.Transpiler({ loader: "ts", tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true } }) });
const show = (src, tr = t, label = "") => { let out; try { out = tr.transformSync(src); } catch (e) { out = "ERROR: " + (e?.errors?.map(x => x.message).join(" | ") ?? e.message); } console.log((label + JSON.stringify(src)).padEnd(70), "=>", JSON.stringify(out)); };
for (const s of [
  "interface I {};", "export interface I {}", "export declare type T = 1;", "declare namespace N {}", "export default interface I {}",
  "module a.b {}", "type T = 1; let x: T;", "interface I<T> extends B<T> { a: T }", "export declare namespace N {}", "export declare interface I {}",
  "abstract class C {}", "declare abstract class C {}", "export declare abstract class C {}",
  "declare class C { m(...a: any[]): void }", "declare class C { constructor(...a: any[]); }", "export declare class C { m(...a: any[]): void }",
  "declare namespace N { class C { m(...a: any[]): void } }", 'declare module "m" { class C { m(...a: any[]): void } }',
  'declare module "m" { export default function f(...a: any[]): void }',
  "class C { [k: string]: number; m() {} }", "class C { static [k: string]: number; x = 1 }", "var x = class { [k: string]: number; };", "class C { [k: string]: number;; }",
  "interface I extends A<T> {}", "class C implements I<T> {}", "class C extends A<T> implements I<U> {}", "var x = class implements I<T> {};",
  'namespace N { (import("x")); }', 'namespace N { (import("x")).then(f); }', 'export namespace N { (import("x")); }',
  "a <= b;", "(a satisfies Foo) <= b;", "(a as typeof b) <= c;", "(a as B.C) <= d;",
]) show(s);
show("class C { accessor a = 1 }", td, "LEGACY ");
show("class C { static accessor a = 1 }", td, "LEGACY ");
show("abstract class C { abstract accessor a: number }", td, "LEGACY ");
show("declare class C { accessor a: number }", td, "LEGACY ");
