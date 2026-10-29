declare const console: { log(...values: unknown[]): void };
console.log("esm evaluated");
export const k = 8;
export function twice(n: number): number { return n * 2 }
export let count = 0;
export function bump(): void { count++ }
