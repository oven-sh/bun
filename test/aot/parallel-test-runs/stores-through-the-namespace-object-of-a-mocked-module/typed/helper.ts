import * as lib from "./lib.mjs";
import { rate } from "./lib.mjs";
const f = (x: number): number => { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return x + 1 + work; };
export function warm(): number { let last = 0; for (let i = 0; i < 300; i++) last = f(i); return last; }
export function swap() { (lib as any).rate = f; return (rate as any)("a"); }
