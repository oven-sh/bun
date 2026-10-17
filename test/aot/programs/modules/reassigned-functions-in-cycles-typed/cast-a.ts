declare const console: { log(...values: unknown[]): void };
import { seen } from "./cast-b";
export function h(n: number): string { return "h" + n; }
export function setH(v: (n: number) => string): void { (h as any) = v; }
console.log("cast", seen, h(2));
