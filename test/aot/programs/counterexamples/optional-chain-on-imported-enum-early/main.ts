// A member of an exported enum, read through an import cycle and an optional chain before the declaration has run, is undefined.
declare const console: { log(...a: unknown[]): void };
import { E as F } from "./main";
console.log(F?.v);
export enum E { v = 1 }
