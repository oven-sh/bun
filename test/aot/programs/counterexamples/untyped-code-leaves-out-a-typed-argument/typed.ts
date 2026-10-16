declare const console: { log(...values: unknown[]): void };
export class Test {
  plain(fn: () => string, timeout: number): string { return fn() + " " + String(timeout) + " " + typeof timeout }
  rest(fn: () => string, timeout: number, ...args: unknown[]): string { return fn() + " " + String(timeout) + " " + args.length }
}
export function free(fn: () => string, timeout: number): string { return fn() + " " + String(timeout) }
export function freeRest(fn: () => string, timeout: number, ...args: unknown[]): string { return fn() + " " + String(timeout) + " " + args.length }
