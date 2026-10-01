import type { T1 } from "x";
import { type T2, v2 } from "x";
import eq = require("y");
import al = NS.inner;
interface I<U> { a: U; m(p: number): typeof v2; }
type A<V> = V extends infer W ? W : never;
declare const dc: number;
declare function dfn(a: number): void;
declare class DC { x: number; m(): void; }
declare namespace DN { const q: number; }
declare global { var gv: number; }
function ov(a: string): void;
function ov(a: number): void;
function ov(a: any) {}
enum E { A = 1, B = A + 1, "C" = 3 }
const enum CE { X }
namespace NS { export const inner = 1; const priv = inner; export namespace Deep { export let d = 1; } }
namespace NS { export const second = inner; }
namespace TypeOnly { export interface J {} }
class K<G> implements I<G> {
  constructor(public pp: number, private readonly qq = pp) {}
  declare df: number;
  abstract am(): void;
  ovm(a: string): void;
  ovm(a: any) {}
  [key: string]: any;
  a!: G;
  m(p: number): typeof v2 { return v2; }
}
abstract class AK { abstract f(): void; }
let x = y as T1, z = <T2>w, nn = u!, sat = s satisfies T1;
function gen<T>(this: Window, a: T, b?: T): a is T { return true; }
export = K;
export as namespace UMD;
export type { T1 };
export { type T2 as T3 };
let fnType: (cb: (e: Error) => void) => void;
