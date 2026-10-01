interface A<T> extends B, C<T> { x: number }
type B = A<string> | string;
declare const c: number, d: string;
declare function f(a: number): string;
export declare function g(): void
@dec declare class K<T> extends L<T> implements M { m(): void; declare p: number; [k: string]: unknown }
declare enum E { A, B = 2 }
declare const enum CE { X }
declare namespace N.O { const x: number; function h(): void; interface I {} }
declare module "m" { export const y: string; global { interface G {} } }
declare module "*.css";
declare global { interface Window { z: number } }
export as namespace MyLib;
import type D from "./d";
import type * as NS from "./ns";
import type { T1, T2 as T3 } from "./t";
import { type U, type V as W } from "./u";
import type R = require("./r");
import type Q = N.O;
export type { T1 };
export type { V1 as V2 } from "./v";
export type * from "./w";
export type * as W2 from "./w";
export { type U };
export { type X1 as X2 } from "./x";
export /* c1 */ interface /* c2 */ Z {} // trailing
function over(a: string): void;
export default interface Dflt {}
