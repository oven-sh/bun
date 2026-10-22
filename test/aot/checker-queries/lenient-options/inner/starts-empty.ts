// Without `noImplicitAny` a variable that starts as `[]` or `null` is no `never[]` and no `null` because the program has `strictNullChecks`: it holds what is stored.
export function evens(list: number[]): number[] { const out = []; for (const n of list) if (n % 2 === 0) out.push(n); return out; }
export function last(list: string[]): string | null { let found = null; for (const s of list) found = s; return found; }
export function first(list: string[]): string | undefined { let found = undefined; for (const s of list) { found = s; break; } return found; }
export function anything() { let value; value = {}; value.more = 1; return value; }
