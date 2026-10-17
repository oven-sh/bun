// `if (isNever(b)) return b` returns b.
declare const console: { log(...a: unknown[]): void };
function isNever(v: unknown): v is never { return true; }
function pick(a: number, b: number): number { if (isNever(b)) return b; return a; }
console.log(pick(1, 2));
