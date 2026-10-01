import { readFileSync } from "fs";
export enum E { A, B }
export function f(a: number): string { return String(a) + readFileSync("x", "utf8"); }
namespace N { export const q = 1; }
export type T = { a: number };
