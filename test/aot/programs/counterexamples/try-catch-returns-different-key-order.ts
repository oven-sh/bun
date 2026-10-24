// A literal returned from `try` and one returned from `catch` each keep the order of their own keys.
declare const console: { log(...a: unknown[]): void };
function f(s: string): { a: number; b: number } { try { return { a: JSON.parse(s), b: 2 }; } catch { return { b: 0, a: 0 }; } }
console.log(Object.keys(f("1")).join());
