declare const console: { log(...values: unknown[]): void };
import { seen } from "./expected-b";
export function h(n: number): string { return "h" + n; }
// @ts-expect-error
export function setH(v: (n: number) => string): void { h = v; }
console.log("expected", seen, h(2));
