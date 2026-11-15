const shelf = new Map<string, number>();
const secret = { hidden: "value" };
export function declared(key: string) { shelf.set(key, 1); return shelf.size; }
export const arrow = () => shelf.size;
export const touchesNothing = (n: number) => n + 1;
export class WithFields { kept = 1; method() { return shelf.size + this.kept; } }
export class WithConstructor { n: number; constructor() { this.n = shelf.size; } }
export class Empty {}
export class Derived extends WithConstructor { more() { return 1; } }
export function OldStyle(this: any) { this.n = shelf.size; }
export function makeCounter() { let count = 0; const log: string[] = []; return { up() { count++; log.push("up"); return count; }, read: () => count + log.length }; }
export function makeHolder() { const inner = secret; return function holder() { return inner.hidden; }; }
export const bound = declared.bind(null, "bound");
export async function waits() { return shelf.size; }
export function* yields() { yield shelf.size; }
export const literal = { method() { return shelf.size; }, arrow: () => 1 };
