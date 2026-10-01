// Writes inputs.json: the inputs of the lint-parse tests for erased statements and class members.
const I = [];
const add = (name, text, file) => I.push(file ? { name, file, text } : { name, text });

// A. a file that holds only erased statements: the statement list of the module is empty
add("only-erased", [
  "interface A<T> extends B<T> { a: T }",
  "type C = A<string> | undefined;",
  "declare var v1: number, v2: string;",
  "declare let l1: A<number>;",
  "declare const c1: unique symbol;",
  "declare function f1<T>(a: T, ...rest: T[]): T;",
  "declare async function f2(): Promise<void>;",
  "declare function* f3(): Generator<number>;",
  "function over(a: string): void;",
  "function over(a: number): void;",
  "declare class K1<T> extends Base<T> implements A<T> { x: T; static y: number; m(): void; constructor(a: T); }",
  "declare abstract class K2 { abstract m(): void }",
  "declare enum E1 { A = 1, B, C = 'c' }",
  "declare const enum E2 { A }",
  "declare namespace N1 { const a: number; function g(): void; interface I {} }",
  "declare namespace N2.N3.N4 { type T = 1 }",
  "declare module M1 { export let z: number }",
  "declare module 'mod-a' { export function h(): void; export default h; }",
  "declare module \"*.css\";",
  "declare module '*!text' { const content: string; export = content; }",
  "declare global { interface Window { w: number } var gv: number }",
  "namespace TypesOnly { export interface I {} export type T = I }",
  "namespace Empty {}",
  "export as namespace Lib;",
  "import type D1 from 'm1';",
  "import type * as S1 from 'm2';",
  "import type { A1, B1 as B2 } from 'm3';",
  "import { type T1, type T2 as T3 } from 'm4';",
  "import type Q1 = require('m5');",
  "import type Q2 = N1.I;",
  "export type { A1 } from 'm6';",
  "export type * from 'm7';",
  "export type * as S2 from 'm8';",
  "export { type T4 } from 'm9';",
  "export { type C };",
  "export type { A };",
  "export type X1 = 1;",
  "export interface X2 {}",
  "export declare const x3: number;",
  "export declare function x4(): void;",
  "export declare class X5 {}",
  "export declare namespace X6 { const a: number }",
  "export namespace X7 { export type T = 1 }",
  "export default interface X8 {}",
  "",
].join("\n"));

// B. erased statements between the statements that stay: the index of the next kept statement
add("interleaved", "interface A {}\nconst a = 1;\ntype B = A;\ndeclare const b: B;\nlet c = a;\nfunction f(x: string): void;\nfunction f(x: number): void;\nfunction f(x: any) {}\nexport type { A };\nexport { c };\ninterface Z {}\n");
add("leading-directive-and-empty", "'use strict';\ninterface A {}\n;\ntype B = 1;\n'other';\ndeclare var x: number;\nfoo();\n");
add("trailing", "foo();\ninterface A {}\ntype B = 1");

// C. nested lists: every owner that calls parse_stmts_up_to
add("block", "{ interface A {} let a = 1; type B = 1; { type C = 2 } declare const d: number; }");
add("function-bodies", "function f() { interface A {} return 1; type B = 1 }\nconst g = function () { type C = 1; };\nconst h = () => { declare const d: number; return d; };\nconst o = { m() { interface E {} }, get p() { type F = 1; return 1 } };\nclass K { m() { type G = 1 } static { interface H {} foo(); type J = 1 } constructor() { type L = 1 } }");
add("try-catch-finally", "try { type A = 1; a() } catch (e) { interface B {} b() } finally { c(); declare let d: number }");
add("kept-namespace", "namespace N { export const a = 1; interface I {} export type T = I; export function f(): void; export function f() {} namespace Inner { type U = 1 } }");
add("kept-namespace-dotted", "namespace A.B.C { interface X {} export const c = 1; type Y = X }\nnamespace D.E { interface Z {} }\nmodule F.G { export type T = 1 }");
add("deep", "function outer() { if (a) { for (;;) { try { interface A {} } finally { type B = 1 } } } else { switch (b) { default: { type C = 1 } } } }");

// D. placeholders that stay in the tree: no list drops them
add("in-tree-single-statement", "if (a) interface A {}\nif (b) type B = 1; else declare var c: number;\nwhile (d) declare function e(): void;\ndo type F = 1; while (g);\nfor (;;) interface H {}\nfor (const i in j) type K = 1;\nfor (const l of m) declare const n: number;\nlabel: interface O {}\nif (p) function q(): void;");
add("in-tree-switch-case", "switch (a) { case 1: type A = 1; interface B {} b(); declare const c: number; break; default: type D = 1 }");
add("in-tree-dotted", "namespace A.B { type T = 1 }\ndeclare namespace C.D.E { const e: number }\nexport namespace F.G { export interface I {} }");

// E. what stands in front of the statement is part of it
add("prefix-export", "export interface A {}\nexport type B = 1;\nexport declare const c: number;\nexport declare function d(): void;\nexport declare class E {}\nexport declare abstract class F {}\nexport declare enum G {}\nexport declare const enum H {}\nexport declare namespace I {}\nexport declare module J {}\nexport function k(): void;\nexport async function l(): Promise<void>;\nexport namespace M {}\nexport import type N = require('n');");
add("prefix-export-default", "export default interface A {}\nexport default function f(a: string): void;\nexport default function f(a: any) {}");
add("prefix-export-default-async", "export default async function f(a: string): Promise<void>;\nexport default async function f(a: any) {}");
add("prefix-declare-order", "declare export class A {}\ndeclare export function b(): void;\ndeclare abstract class C {}\ndeclare type D = 1;\ndeclare interface E {}\ndeclare import F = G.H;\ndeclare import type I from 'i';\ndeclare;");
add("prefix-decorators", "@a declare class A {}\n@b.c(1) @(d) export declare abstract class B {}\nexport @e declare class C {}\n@f declare abstract class D { @g m(): void }");
add("prefix-async-generator", "async function a(): Promise<void>;\nasync function a() {}\nfunction* b(): Generator;\nfunction* b() {}\ndeclare async function c(): Promise<void>;");
add("prefix-comments", "/** doc */ export /* a */ declare /* b */ const /* c */ x: number; // tail\n/* lead */ interface A {} /* trail */\n// line\ntype B = 1 // no semicolon\ndeclare function f(): void /* before eof */");

// F. erased statements inside erased statements
add("nested-declare-namespace", "declare namespace N { interface A {} const a: number; type B = A; function f(): void; class K { m(): void; [k: string]: any } enum E { X } namespace Inner { interface C {} let c: C } import q = Inner.C; export import r = Inner.C; export { a }; foo(); }");
add("nested-ambient-module", "declare module 'pkg' { import type { T } from 'dep'; import v from 'dep2'; export function f(t: T): void; export default f; global { interface G {} var gg: number; } export as namespace pkgNs; }");
add("nested-global", "declare global { interface A {} var a: A; namespace NS { type T = 1 } function f(): void; declare global { type Inner = 1 } }");
add("nested-kept-in-erased", "declare function f() { interface A {} return 1; type B = 1 }\ndeclare class K { m() { type C = 1 } static { interface D {} } x = () => { type E = 1 } }\ndeclare namespace N { const o = { m() { interface F {} } }; class L { n() { type G = 1 } } }");

// G. `export declare var` in a namespace: the tree holds an `export var` in its place
add("stand-in", "namespace N { export declare const a: number; export declare let { b, c }: T, [d]: U; interface I {} export declare var e: string; export const f = 1 }\ndeclare namespace M { export declare const g: number; interface J {} }");

// H. speculation: the arrow body between `?` and `:` is parsed twice
add("speculation-arrow-kept", "const r = a ? (b): c => { type T = 1; interface I {} declare const d: number; return d } : e;");
add("speculation-arrow-dropped", "const r = a ? (b) : c => { type T = 1; interface I {} return c };");
add("speculation-arrow-nested", "const r = a ? (b): c => { type T = 1; return x ? (y): z => { interface I {} return 1 } : w } : e;");

// I. class members
add("members-overloads", "class C { m(): void; m(a: string): void; m(a?: string) {} static s(): void; static s() {} async n(): Promise<void>; async n() {} *g(): Generator; *g() {} [k](): void; [k]() {} 'q'(): void; 'q'() {} 1(): void; 1() {} #p(): void; #p() {} constructor(); constructor(a: string); constructor(a?: any) {} get x(): number; set x(v: number); }");
add("members-abstract", "abstract class C { abstract a: number; abstract b(): void; abstract get c(): number; abstract set c(v: number); protected abstract d?: string; abstract static e: number; private abstract f(): void; abstract g() {} abstract [h]: number; kept = 1; abstract i: number }");
add("members-declare", "class C { declare a: number; declare readonly b: string; declare static c: number; static declare d: number; declare e; kept() {} declare f(): void }");
add("members-index-signatures", "class C { [k: string]: any; static [k: number]: string; readonly [k: symbol]: unknown; a = 1; static readonly [k: string]: number; declare [k: string]: any }");
add("members-decorated", "abstract class C { @d abstract a: number; @d declare b: number; @d abstract c(): void; @d m(): void; @d m() {} }");
add("members-class-expression", "const C = class { m(): void; m() {} [k: string]: any; declare x: number };\nexport default class { n(): void; n() {} }");
add("members-semicolons", "class C { ; m(): void;; m() {}; ; [k: string]: any;; }");

// J. ends: with and without `;`, at end of file, before `}`
add("ends", "type A = 1\ntype B = 2;\ninterface C {}\ninterface D {};\ndeclare const e: number\ndeclare function f(): void\nexport type { A }\nexport type { B } from 'b'\nimport type G from 'g'\nimport type H = require('h')\nexport as namespace ns\ndeclare namespace I {}\ndeclare module 'j'\ndeclare enum K {}\n{ type L = 1 }\nfunction m() { type N = 1 }");

// K. import attributes and odd names
add("paths-and-attributes", "import type A from 'a' with { 'resolution-mode': 'import' };\nimport type { B } from \"b\" with { type: 'json' };\nexport type { C } from 'c' with { 'resolution-mode': 'require' };\nexport type * as D from 'd';\nexport type * as 'e-e' from 'e';\nimport { type default as F, type 'g-g' as G } from 'f';\nexport { type H as default, type I as 'i-i' } from 'h';");
add("contextual-names", "type type = 1;\ninterface of {}\ndeclare namespace global { }\ndeclare module async { }\nimport type from_ from 'x';\nimport type type from 'y';\nimport type * as as from 'z';");

// M. traps for the backward search of `export` and for names that the parser never reads
add("export-scan-traps", "export declare global { interface A {} var v: typeof a.export\ninterface B {} }\nnamespace N.export.C { type T = 1 }\nexport\ninterface D {}\nfoo.export\ninterface E {}");
add("ambient-module-names", "declare module \"a\\u0062c\" {}\ndeclare module '*.svg' { const s: string; export default s }\ndeclare module \"quote\\\"d\";\ndeclare module Foo.Bar {}");
add("import-equals-forms", "import type A = require('a');\nexport import type B = C.D.E;\ndeclare namespace N { import F = G; import H = require('h'); export import I = J.K; }\ndeclare import /* c */ L = M;\nnamespace O { import P = Q.R; }");

// L. declaration files: the whole file is ambient
add("dts", "export function f(a: string): void;\nexport const c: number;\nexport class K { m(): void; x: number }\ninterface I {}\ndeclare namespace N { const a: number }\nexport as namespace lib;\nexport default f;\n", "a.d.ts");

require("fs").writeFileSync(__dirname + "/inputs.json", JSON.stringify(I, null, 1) + "\n");
console.log(I.length + " inputs");
