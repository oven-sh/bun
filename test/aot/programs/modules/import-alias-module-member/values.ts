export let m = 1;
export function bump() { m++; }
export function f(n: number) { return n + 1; }
export const v = 5;
export class K { x = 1; static s = "s"; }
export enum E { A = 1, B = 2 }
export const enum CE { P = 10, Q = 20 }
export namespace inner { export let n = 10; export function up() { n++; } export const w = 7; export namespace most { export const bottom = "bottom"; export function g() { return "g"; } } }
export const obj = { x: 1, y: { z: 2 } };
export let arrow = () => "first";
export function swap() { arrow = () => "second"; }
