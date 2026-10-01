import { writeFileSync } from "fs";
const only = `interface A<T> extends B { x: T }
type C = A<string> | undefined;
declare var v1: number, v2: string;
declare let l1: boolean;
declare const k1: 1, { d1, d2: [d3] }: any;
declare function f1<T>(a: T, ...rest: string[]): T;
function over(a: string): void;
async function aover(): Promise<void>;
declare class K<T> extends Base<T> implements I1 { p: T; m(): void; constructor(a: T); static [key: string]: any; declare q: number }
@dec declare abstract class DK { abstract am(): void }
declare enum E1 { A = 1, B, "c" = 3 }
declare const enum E2 { X }
declare namespace N1 { const nx: number; function nf(): void; interface NI {} namespace Inner.Deep { type T = 1 } export class NC {} enum NE {} import ie = require("y"); }
namespace TypeOnly { export interface TI {} type TT = 2 }
declare module "ambient" { export const y: string; global { interface G {} } }
declare module "*.css";
declare global { interface Window { z: number } var gv: string }
export as namespace MyLib;
import type D from "./d";
import type * as NS from "./ns";
import type { T1, T2 as T3 } from "./t";
import { type U1, type V1 as W1 } from "./u";
import type R = require("./r");
import type Q = N1.Inner;
export type { T1 };
export type { V2 as V3 } from "./v";
export type * from "./w";
export type * as W2 from "./w2";
export { type U1 };
export { type X1 as X2 } from "./x";
export interface EI {}
export type ET = 1;
export declare const ec: number;
export declare function ef(): void;
export default interface DI {}
`;
const mixed = `type A = 1;
const a0 = 1;
interface B {}
function f(x: number): void;
function f(x: string): void;
function f(x: any) {
  type C = 2;
  if (x) { interface D {} }
  try { type E = 3 } catch { type F = 4 } finally { type G = 5 }
  const g = () => { type H = 6; return 1 };
  switch (x) { case 1: type I = 7; break; default: declare const j: number; }
  lbl: type K = 8;
  if (x) interface L1 {} else type L2 = 9;
  while (x) declare function w(): void;
  for (;;) type L3 = 10;
  do interface L4 {} while (x);
  declare let last: number
}
namespace NS { export const v = 1; type L = 9; export function h(): void; export function h() {} export declare const lowered: number; }
class Cls { static { type M = 10; const s = 1; interface N {} } }
namespace a.b { interface X {} }
namespace c.d { export const y = 2; type Z = 1 }
export declare const z: number;
export {};
type Last = 0`;
const members = `abstract class M {
  m(): void;
  m(a?: string): void;
  m(a?: any) {}
  constructor();
  constructor(a?: number) { }
  abstract am(): void;
  abstract get ag(): number;
  abstract set ag(v: number);
  protected abstract readonly af: string;
  declare df: number;
  declare static ds: string;
  static [k: string]: unknown;
  readonly [n: number]: string;
  opt?(): void;
  [Symbol.iterator](): Iterator<number>;
  #priv(): void;
  #priv() {}
  @dec abstract kept1: number;
  @dec declare kept2: number;
  @dec abstract dropped(): void;
  abstract withBody() { type Inner = 1 }
  declare abstract both: number;
  static async *gen(): AsyncGenerator<number>;
  keptField = 1;
}
const Expr = class { e(): void; e() {} [k: string]: any };`;
const prefixes = `export declare function a(): void
declare export class B {}
@d1 export declare class C {}
export @d2 declare class D {}
export default function e(x: string): void;
export default function e(x: any) {}
export async function g(): Promise<void>;
export async function g() {}
/* lead */ export /* c1 */ declare /* c2 */ const h: number /* trail */ ; // line
type I = Array<Array<number>>
type J = 1 /* same line */
interface K { a: 1 } // after
declare const enum L { A } declare var m: number;;
type Z = 0`;
const inputs = [
  { name: "erased-only", text: only },
  { name: "mixed", text: mixed },
  { name: "members", text: members },
  { name: "prefixes", text: prefixes },
  { name: "default-async-overload", text: "export default async function n(): Promise<void>;\nexport default async function n() {}\nexport default interface DI2 {}" },
  { name: "snapshot-arrow-body", text: "let v = a ? (x): number => { type U = 1; interface I {} declare const d: number; function o(): void; function o() {} return x } : b;" },
  { name: "snapshot-class-members", text: "let v = a ? (x): C => { class K { m(): void; m() {} [k: string]: any; declare p: number } return new K } : b;" },
  { name: "snapshot-not-arrow", text: "let v = a ? (x) : y => { type U = 1; return y };" },
  { name: "snapshot-nested", text: "let v = a ? (x): any => (b ? (y): any => { type T = 1; return y } : c) : d;" },
  { name: "specifiers", text: "import { type as as x, type a, type 'str' as s, type default as d, b } from 'm';\nimport { type c } from 'n';\nexport { type as, type as as y, type e as f, g };\nexport { type h } from 'o';\nexport { type i };\nimport type { type j } from 'p';" },
  { name: "import-equals", text: "import type A = require(\"a\");\nimport type B = C.D.E;\nexport import type F = G.H;\nimport kept = C.D;\ndeclare namespace N { import x = require(\"y\"); export import z = A.B; }\nnamespace OnlyImports { import q = C.D; }" },
  { name: "global-nesting", text: "declare module \"m\" { type Before = 1; global { interface G {} function gf(a = () => { type InFn = 1 }): void; var gv: number; type After = 2 } const c: number; type End = 3 }\ndeclare global { namespace NodeJS { interface ProcessEnv {} } type GT = 1 }\nexport {};" },
  { name: "declare-empty", text: "declare;\nfoo()" },
  { name: "ambient-names", text: "declare module \"fs\" { }\ndeclare module '*.css' { const c: string; export default c }\ndeclare module \"x\";\ndeclare module \"a\\u0062c\" {}\nmodule M1 { export type T = 1 }\nnamespace N2.N3 { }\n" },
  { name: "h18-stale-merge", text: "namespace module { export const a = 1 }\ndeclare module \"fs\" { export const b: number }\nnamespace module { console.log(typeof b, a) }" },
  { name: "dts", file: "a.d.ts", text: "export function f(): void;\nexport const x: number;\ndeclare const y: string;\nexport default class C { m(): void }\nimport fs = require(\"fs\");\nexport namespace NS { const q: number }\n" },
  { name: "scopes", text: "declare function f(a = () => 1, { b } = {}): void;\nfunction g(cb = function () {}): void;\nfunction g() {}\ndeclare class C { m(a = class {}) { return () => 1 } static { lbl: for (;;) {} } }\nabstract class D { abstract m(a = () => 1): void; @dec(() => 1) abstract n: number; [k: string]: any }\ndeclare enum E { A = (() => 1)() }\nif (x) function h(): void;\ndeclare global { function gf(a = () => 1): void }\ndeclare namespace N { class K { m() { { let z } } } }\nfoo(() => 1);" },
];
writeFileSync("tests.json", JSON.stringify(inputs, null, 1));
writeFileSync("tests.probe.json", JSON.stringify(inputs.filter(i => !i.file).map(i => [i.name, i.text])));
