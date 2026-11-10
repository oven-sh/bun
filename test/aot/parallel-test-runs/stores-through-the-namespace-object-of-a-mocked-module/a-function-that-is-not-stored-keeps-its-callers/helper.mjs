import * as lib from "./lib.mjs";
import { rate } from "./lib.mjs";
const f = (x) => { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return x + 1 + work; };
export function warm() { let last = 0; for (let i = 0; i < 300; i++) last = f(i); return last; }
const g = (x) => { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return x + 2 + work; };
export function swap() { lib.rate = f; let sum = 0; for (let i = 0; i < 300; i++) sum += g(i); return rate("a") + sum; }
