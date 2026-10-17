// A function declaration merged with a namespace, whose name is stored to through a cast, is called by a module that runs before the namespace's body has.
declare const console: { log(...values: unknown[]): void };
import { seen } from "./other";
export function h(): string { return "h"; }
export namespace h { export const extra = 3; export function inner(): string { return "i" + h(); } }
export function setH(v: unknown): void { (h as any) = v; }
console.log(seen, h(), h.extra, h.inner());
